'use client'
import { useRef } from 'react'
import { useChatStore } from '@/lib/store/useChatStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useConnectionStore } from '@/lib/store/useConnectionStore'
import { useHistoryStore } from '@/lib/store/useHistoryStore'
import { AIResponseStreamParser, parseAIResponseActions } from '@/lib/ai/parser'
import { consumeAIStream } from '@/lib/ai/stream'
import { buildOrchestrationHeaders } from '@/lib/ai/orchestration'
import { classifyResearchIntent } from '@/lib/research/intent'
import { renderCitations } from '@/lib/research/normalize'
import { frameUntrustedContent } from '@/lib/research/security'
import type { SearchResult } from '@/lib/research/types'
import { generationWorksKeyless, modelOption, type ModelOption } from '@/lib/ai/catalog'
import { isModelConsented } from '@/components/settings/model-cost-consent'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { PROVIDERS } from '@/lib/constants/models'
import { applyWorkspaceFiles, applyWorkspaceResponse, executeWorkspaceCommand, executeWorkspaceCommandWithOutput } from '@/lib/workspace/actions'
import { runProject } from '@/lib/webcontainer'
import type { ParsedFile } from '@/types'
import { toast } from 'sonner'

import { useAppStore } from '@/lib/store/useAppStore'
import { parseSafeNpmCommand } from '@/lib/ai/parser'

export function trimClientHistory(
  rawMessages: Array<{ role: string; content: string }>,
  files: Record<string, string>,
  maxCount = 16,
  maxBytes = 900_000
): { messages: Array<{ role: string; content: string }>; trimmed: boolean } {
  let trimmed = false
  let messages = rawMessages.slice()
  if (messages.length > maxCount) {
    messages = messages.slice(-maxCount)
    trimmed = true
  }

  const filesSize = JSON.stringify(files).length
  while (messages.length > 1) {
    const estimatedPayload = filesSize + JSON.stringify(messages).length + 2048
    if (estimatedPayload <= maxBytes) break
    messages.shift()
    trimmed = true
  }

  return { messages, trimmed }
}

/** Stable per-browser workspace identity for checkpoint scoping (Master 5.2). */
function getWorkspaceId(): string {
  if (typeof window === 'undefined') return 'default'
  try {
    const existing = window.localStorage.getItem('yuha-workspace-id')
    if (existing && /^[\w-]{1,64}$/.test(existing)) return existing
    const fresh = crypto.randomUUID()
    window.localStorage.setItem('yuha-workspace-id', fresh)
    return fresh
  } catch { return 'default' }
}

interface PendingBlueprintSummary {
  objective?: string
  siteType?: string
  pages?: string[]
  coreFeatures?: string[]
  ambiguities?: Array<{ question?: string; defaultAssumption?: string }>
}

/** Auto web-research (Master 10): returns a compact UNTRUSTED-framed research
 *  block for the outgoing prompt, or null when research is not needed/not
 *  configured. Failures are honest toasts, never silent, never blocking. */
async function runAutoResearch(content: string): Promise<string | null> {
  const settings = useSettingsStore.getState()
  const decision = classifyResearchIntent(content)
  if (!settings.research.autoResearch || !decision.needsSearch) return null
  const research = settings.research
  const order = research.order.filter(provider => research.enabled[provider] !== false)
  const usable = order.filter(provider => provider === 'searxng' || provider === 'duckduckgo' || research.keys[provider])
  if (!usable.length) {
    toast.info('Web Research aktif tetapi belum ada provider riset terkonfigurasi. Tambahkan key di Settings › Web Research.')
    return null
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    for (const provider of ['tavily', 'serpapi', 'searxng', 'duckduckgo', 'brave', 'exa', 'firecrawl'] as const) {
      const key = research.keys[provider]
      if (key) headers[`x-yuha-research-key-${provider}`] = key
    }
    const response = await fetch('/api/research', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'search', query: decision.query, order: usable, maxResults: research.maxResults, searxngBaseUrl: research.searxngBaseUrl || undefined }),
      signal: AbortSignal.timeout(45_000),
    })
    const payload = await response.json() as { results?: SearchResult[]; usedProviders?: string[]; failures?: Array<{ provider: string; kind: string; detail: string }>; error?: string }
    if (!response.ok || !Array.isArray(payload.results) || !payload.results.length) {
      const detail = payload.error ?? (payload.failures ?? []).map(f => `${f.provider}: ${f.kind}`).join('; ') ?? 'tidak ada hasil'
      toast.warning(`Riset web tidak menghasilkan data (${detail}). Melanjutkan tanpa konteks web.`)
      return null
    }
    toast.message(`Riset web: ${payload.results.length} sumber via ${(payload.usedProviders ?? []).join(', ') || 'provider'}`, { description: payload.results.slice(0, 3).map(r => r.domain).join(', ') })
    const block = [
      'RESEARCH CONTEXT (untrusted web data gathered for this request):',
      renderCitations(payload.results),
      ...payload.results.slice(0, 3).map((result, index) => frameUntrustedContent(result.url, result.snippet).replace('BEGIN UNTRUSTED WEB CONTENT', `BEGIN SOURCE [${index + 1}] ${result.domain}`)),
    ].join('\n\n')
    return block.slice(0, 12_000)
  } catch (error) {
    toast.warning(`Riset web gagal (${error instanceof Error ? error.message : 'kesalahan jaringan'}). Melanjutkan tanpa konteks web.`)
    return null
  }
}

export function useAIChat() {
  const state = useChatStore()
  const abortRef = useRef<AbortController | null>(null)
  // Live catalog for the debugger override so a VERIFIED-FREE debugger model
  // can be honoured without the global paid-models permission (Pass 13 Phase 6).
  const debuggerOverrideProvider = useSettingsStore(s => s.roleModels?.debugger?.provider)
  const debuggerCatalog = useModelCatalog(debuggerOverrideProvider ?? 'gemini')

  const applyFiles = async (files: ParsedFile[]) => {
    await applyWorkspaceFiles(files)
    if (files.length) toast.success(`Applied ${files.length} ${files.length === 1 ? 'file' : 'files'} to your project`)
  }

  const sendMessage = async (content: string, internalOpts?: { blueprintApproved?: boolean; reuseLastUserMessage?: boolean }) => {
    const chat = useChatStore.getState()
    const settings = useSettingsStore.getState()
    if (!content.trim() || chat.isStreaming) return
    if (content.length > 100_000) {
      chat.setError('Please keep your message under 100,000 characters.')
      return
    }

    const key = settings.getApiKey(settings.activeProvider)
    if (!settings.activeModel) {
      chat.setError('Pilih model yang tersedia di Settings sebelum mulai membuat proyek.')
      return
    }
    // Local runtimes (Ollama) work without a credential; cloud providers require one.
    if (!key && !generationWorksKeyless(settings.activeProvider)) {
      chat.setError(`Add your ${PROVIDERS[settings.activeProvider].name} API key in Settings to bring your idea to life.`)
      return
    }

    const rawMessages = internalOpts?.reuseLastUserMessage
      ? [...chat.messages.filter(message => message.content)]
      : [
        ...chat.messages.filter(message => message.content),
        { id: crypto.randomUUID(), role: 'user' as const, content: content.trim(), timestamp: Date.now() },
      ]
    if (!internalOpts?.reuseLastUserMessage) chat.addMessage(rawMessages[rawMessages.length - 1])
    chat.setDraft('')
    chat.setError(null)
    chat.setStreaming(true)

    const assistantId = crypto.randomUUID()
    chat.addMessage({ id: assistantId, role: 'assistant', content: '', timestamp: Date.now() })
    const controller = new AbortController()
    abortRef.current = controller
    const credential = settings.apiKeys[settings.activeProvider] || ''
    const start = Date.now()
    let fullText = ''
    let complete = false
    let pendingBlueprint: PendingBlueprintSummary | null = null
    const parser = new AIResponseStreamParser()
    // Repair integrity (Master 3.2): the orchestrator emits the REPAIRED files
    // it verified as structured `files` events; the raw delta stays as the
    // chat transcript. Prefer the repaired set so the workspace matches what
    // the verification gate actually validated.
    const serverFiles: ParsedFile[] = []
    let projectBeforeGeneration: { files: Record<string, string>; projectName: string; activeFile: string | null } | null = null
    let historySnapshotCreated = false
    const savePreChangeSnapshot = () => {
      const previous = projectBeforeGeneration
      if (!previous || historySnapshotCreated) return
      try {
        useHistoryStore.getState().createSnapshot({
          label: 'Sebelum perubahan AI',
          projectName: previous.projectName,
          files: previous.files,
          activeFile: previous.activeFile ?? undefined,
        })
        historySnapshotCreated = true
      } catch (historyError) {
        historySnapshotCreated = true
        toast.warning(historyError instanceof Error ? `Snapshot otomatis dilewati: ${historyError.message}` : 'Snapshot otomatis tidak dapat dibuat.')
      }
    }

    try {
      const files = useFileStore.getState().files
      projectBeforeGeneration = {
        files: { ...files },
        projectName: useFileStore.getState().projectName,
        activeFile: useFileStore.getState().activeFile,
      }

      // D1: Client-side history trimming (max 16 messages, payload under 900 KB).
      // Auto web-research (Master 10): when enabled AND the intent needs fresh
      // data, gather sources now and attach them as UNTRUSTED-framed context
      // on the outgoing (API-only) message — the chat transcript stays clean.
      const researchBlock = await runAutoResearch(content)
      const mappedMessages = rawMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent }))
      if (researchBlock) {
        const lastUser = [...mappedMessages].reverse().find(message => message.role === 'user')
        if (lastUser) lastUser.content = `${lastUser.content}\n\n${researchBlock}`
      }
      const { messages: trimmedMessages, trimmed } = trimClientHistory(mappedMessages, files, 16, 900_000)
      if (trimmed) {
        toast.info('Riwayat percakapan dipangkas untuk memenuhi batas ukuran permintaan.')
      }

      const isEconomy = settings.collaborationMode === 'economy'
      let response: Response

      if (isEconomy) {
        // D2: Economy mode uses /api/chat directly with real streaming
        response = await fetch('/api/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
          },
          body: JSON.stringify({
            provider: settings.activeProvider,
            model: settings.activeModel,
            messages: trimmedMessages,
            files,
            allowPaidModels: settings.allowPaidModels,
            consentedModel: isModelConsented(settings.activeProvider, settings.activeModel) ? `${settings.activeProvider}:${settings.activeModel}` : undefined,
          }),
        })
      } else {
        // Balanced and Max modes use multi-model orchestrator. Keys are sent for
        // the core providers (supporting roles) AND the active provider, so a
        // kimi/qwen/ollama primary is not rejected with a false 401.
        const orchestrationHeaders = buildOrchestrationHeaders(provider => settings.getApiKey(provider), settings.activeProvider)
        response = await fetch('/api/orchestrate', {
          method: 'POST',
          signal: controller.signal,
          headers: orchestrationHeaders,
          body: JSON.stringify({
            provider: settings.activeProvider,
            model: settings.activeModel,
            mode: settings.collaborationMode,
            allowPaidModels: settings.allowPaidModels,
            consentedModel: isModelConsented(settings.activeProvider, settings.activeModel) ? `${settings.activeProvider}:${settings.activeModel}` : undefined,
            roleOverrides: settings.roleModels,
            messages: trimmedMessages,
            files,
            workspaceId: getWorkspaceId(),
            ...(internalOpts?.blueprintApproved ? { blueprintApproved: true } : {}),
          }),
        })
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: unknown }
        throw new Error(typeof error.error === 'string' ? error.error : `Request failed (${response.status}). Check your provider settings.`)
      }

      await consumeAIStream(response, {
        onEvent: event => {
          if (event.type === 'stage' && typeof event.message === 'string') toast.loading(event.message, { id: 'yuha-agent-stage' })
          if (event.type === 'notice' && typeof event.message === 'string') toast.warning(event.message)
          if (event.type === 'review' && typeof event.summary === 'string') toast.message('Hasil review independen diterima', { description: event.summary.slice(0, 220) })
          if (event.type === 'verification' && event.report && typeof event.report === 'object') {
            const report = event.report as { overallStatus?: string }
            const status = String(report.overallStatus ?? 'NOT RUN')
            if (status === 'PASSED' || status === 'Passed') toast.success('Verification gate: PASSED (static levels).')
            else if (status === 'FAILED' || status === 'Failed') toast.error('Verification gate: FAILED — periksa notice untuk detail level yang gagal.')
            else toast.message(`Verification gate: ${status}`)
          }
          if (event.type === 'agent-plan' && Array.isArray(event.tasks)) toast.message('Rencana agen siap', { description: `${event.tasks.length} tugas akan dikerjakan secara berurutan.` })
          if (event.type === 'agent-task-complete' && typeof event.task === 'string') toast.success(`Tugas agen selesai: ${event.task}`, { duration: 1800 })
          if (event.type === 'blueprint' && event.blueprint && typeof event.blueprint === 'object') {
            pendingBlueprint = event.blueprint as PendingBlueprintSummary
          }
          if (event.type === 'files' && Array.isArray(event.files)) {
            for (const candidate of event.files) {
              const file = candidate as { path?: unknown; content?: unknown; language?: unknown }
              if (typeof file.path === 'string' && typeof file.content === 'string') {
                serverFiles.push({ path: file.path, content: file.content, language: typeof file.language === 'string' ? file.language : undefined })
              }
            }
          }
          if (event.type === 'meta' && Array.isArray(event.roles)) {
            const roleNames = event.roles.map(role => { const item = role as { provider?: string; model?: string }; return item.provider && item.model ? `${item.provider}: ${item.model}` : '' }).filter(Boolean)
            if (roleNames.length) toast.message('Model yang terlibat', { description: roleNames.join(' → ') })
          }
          if (event.type === 'done' || event.type === 'error') toast.dismiss('yuha-agent-stage')
        },
        onDelta: delta => {
          fullText += delta
          chat.updateMessage(assistantId, { content: fullText })
          const streamedFiles = parser.push(delta)
          if (streamedFiles.length) savePreChangeSnapshot()
          for (const file of streamedFiles) {
            useFileStore.getState().updateFileContent(file.path, file.content)
          }
        },
      })
      complete = true

      // Master 6.1: blueprint gate — generation stopped server-side until the
      // user approves. Ask now; on approval, re-send the SAME instruction with
      // blueprintApproved (no duplicate user message). This check runs BEFORE
      // the empty-text guard because the gated stream legitimately has no text.
      if (pendingBlueprint && !internalOpts?.blueprintApproved) {
        chat.setStreaming(false)
        chat.removeMessage(assistantId)
        // The assignment happens inside the stream callback, which TS control
        // flow cannot see — read through an explicit cast.
        const bp = pendingBlueprint as PendingBlueprintSummary
        const summary = [
          `Tujuan: ${bp.objective ?? '-'}`,
          `Jenis: ${bp.siteType ?? '-'}`,
          `Halaman: ${(bp.pages ?? []).slice(0, 6).join(', ') || '-'}`,
          `Fitur inti: ${(bp.coreFeatures ?? []).slice(0, 4).join(', ') || '-'}`,
          ...(bp.ambiguities ?? []).filter(a => a.question).slice(0, 2).map(a => `Pertanyaan terbuka: ${a.question} (asumsi: ${a.defaultAssumption})`),
        ].join('\n')
        const approved = await useAppStore.getState().requestConfirmation({
          title: 'Setujui Blueprint Proyek',
          description: 'Proyek kompleks terdeteksi. YUHA menunggu persetujuan Anda sebelum menulis kode.',
          command: summary.slice(0, 600),
        })
        if (approved) {
          toast.success('Blueprint disetujui. Melanjutkan generasi dengan konteks blueprint.')
          await sendMessage(content, { blueprintApproved: true, reuseLastUserMessage: true })
        } else {
          toast.info('Blueprint ditolak. Ubah instruksi Anda lalu kirim ulang bila ingin rencana berbeda.')
        }
        return
      }

      if (!fullText.trim()) throw new Error('Model returned no text. Test this model in Settings or select another model.')

      const recoverFullFiles = async (instruction: string, recoveryFiles = files): Promise<string> => {
        toast.warning('Patch tidak cocok. Meminta file utuh tanpa mengubah file sumber.')
        const recoveryMessages = [...mappedMessages, { role: 'user', content: instruction }]
        const recovery = await fetch('/api/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({
            provider: settings.activeProvider, model: settings.activeModel,
            messages: trimClientHistory(recoveryMessages, recoveryFiles).messages, files: recoveryFiles,
            allowPaidModels: settings.allowPaidModels,
            consentedModel: isModelConsented(settings.activeProvider, settings.activeModel) ? `${settings.activeProvider}:${settings.activeModel}` : undefined,
          }),
        })
        if (!recovery.ok) throw new Error(`Permintaan file utuh gagal (${recovery.status}). File patch tidak diubah.`)
        let recoveredText = ''
        await consumeAIStream(recovery, { onDelta: delta => { recoveredText += delta } })
        return recoveredText
      }
      savePreChangeSnapshot()
      const actions = serverFiles.length
        ? { files: serverFiles, commands: parseAIResponseActions(fullText).commands }
        : await applyWorkspaceResponse(fullText, files, recoverFullFiles)
      const parsed = actions.files
      chat.updateMessage(assistantId, { files: parsed })
      if (serverFiles.length) await applyFiles(parsed)

      // C2: Require user confirmation dialog before executing any model shell commands
      for (const command of actions.commands) {
        const safe = parseSafeNpmCommand(command)
        if (!safe) {
          toast.error(`Perintah ditolak karena tidak aman: ${command}`)
          continue
        }
        const approved = await useAppStore.getState().requestConfirmation({
          title: 'Konfirmasi Perintah Terminal',
          description: 'Model AI mengusulkan perintah shell berikut:',
          command,
        })
        if (!approved) {
          toast.info(`Perintah shell dibatalkan oleh pengguna: ${command}`)
          continue
        }
        try {
          await executeWorkspaceCommand(safe.executable, safe.args)
        } catch (commandError) {
          toast.error(commandError instanceof Error ? commandError.message : 'Terminal action failed.')
        }
      }

      // First run: install dependencies and start the preview after a complete project artifact.
      let currentFiles = useFileStore.getState().files
      let packageScripts: Record<string, unknown> = {}
      try {
        const packageJson = JSON.parse(currentFiles['package.json'] || '{}') as { scripts?: Record<string, unknown> }
        packageScripts = packageJson.scripts || {}
      } catch { /* Handled below */ }

      if (parsed.length > 0 && currentFiles['package.json'] && typeof packageScripts.dev === 'string') {
        try {
          // Master 8.1: auto-run of `npm run dev` + `npm run build` needs an
          // explicit (one-time, remembered) user consent — never silent.
          if (!settings.executionAutoRunConsented) {
            const consented = await useAppStore.getState().requestConfirmation({
              title: 'Izinkan Eksekusi Otomatis',
              description: 'YUHA menjalankan `npm install --ignore-scripts`, `npm run dev`, dan `npm run build` di WebContainer untuk preview & verifikasi hasil. Setuju sekali untuk mengingat izin ini?',
              command: 'npm install --ignore-scripts · npm run dev · npm run build',
            })
            if (!consented) {
              toast.info('Eksekusi otomatis tidak diizinkan. Hasil generasi tetap tersimpan; jalankan preview manual dari panel Run bila diperlukan.')
              chat.setStreaming(false)
              return
            }
            useSettingsStore.getState().setExecutionAutoRunConsented(true)
          }
          await runProject(currentFiles)
          if (typeof packageScripts.build === 'string') {
            let validation = await executeWorkspaceCommandWithOutput('npm run build')
            let repairAttempt = 0
            while (validation.exitCode !== 0 && repairAttempt < 2 && !controller.signal.aborted) {
              repairAttempt += 1
              const diagnostic = validation.output.slice(-18_000) || `npm run build exited with code ${validation.exitCode} without captured output.`
              const repairPrompt = [
                `The project build failed (repair attempt ${repairAttempt}/2). Fix the actual errors below.`,
                'Return only complete changed files using the required boltArtifact/boltAction file protocol. Do not claim success. Do not run shell commands.',
                'Build output:', diagnostic,
              ].join('\n\n')

              // D4 + Pass 13 Phase 6: auto-repair uses the Debugger role model when it
              // is catalog-verified free (or free-tier) OR the user allowed paid
              // models. Paid/unverified overrides stay blocked without consent.
              const debugOverride = settings.roleModels?.debugger
              const debugOverrideModel: ModelOption | undefined = debugOverride?.provider && debugOverride.model
                ? debuggerCatalog.models.find(entry => entry.id === debugOverride.model)
                : undefined
              let debuggerProvider = settings.activeProvider
              let debuggerModel = settings.activeModel
              if (debugOverride?.provider && debugOverride.model) {
                const tier = debugOverrideModel?.tier ?? modelOption(debugOverride.provider, debugOverride.model).tier
                if (tier === 'free' || tier === 'free-tier' || settings.allowPaidModels) {
                  debuggerProvider = debugOverride.provider
                  debuggerModel = debugOverride.model
                } else {
                  toast.info(`Debugger ${debugOverride.model} berbiaya ${tier === 'paid' ? 'diketahui berbayar' : 'belum terverifikasi'}; perbaikan build memakai model aktif. Aktifkan izin model berbayar di Settings bila memang diinginkan.`)
                }
              }
              // Master Prompt section 4: API keys NEVER cross providers. The
              // debugger must use its OWN provider's key; if that provider has
              // no key, the repair attempt is skipped with an honest message
              // instead of silently borrowing the active provider's key.
              const debuggerKey = settings.getApiKey(debuggerProvider)
              if (!debuggerKey && !generationWorksKeyless(debuggerProvider)) {
                toast.warning(`Auto-repair dilewati: tidak ada API key tersimpan untuk provider Debugger (${PROVIDERS[debuggerProvider].shortName}). Simpan key-nya di Settings untuk mengaktifkan perbaikan otomatis.`)
                break
              }

              const rawRepairMessages = [
                ...mappedMessages,
                { role: 'assistant', content: fullText.slice(-30_000) },
                { role: 'user', content: repairPrompt },
              ]
              const { messages: trimmedRepairMessages } = trimClientHistory(rawRepairMessages, currentFiles, 16, 900_000)

              const repairResponse = await fetch('/api/chat', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': debuggerKey,
                },
                body: JSON.stringify({
                  provider: debuggerProvider,
                  model: debuggerModel,
                  messages: trimmedRepairMessages,
                  files: currentFiles,
                  allowPaidModels: settings.allowPaidModels || isModelConsented(debuggerProvider, debuggerModel),
                  consentedModel: isModelConsented(debuggerProvider, debuggerModel) ? `${debuggerProvider}:${debuggerModel}` : undefined,
                }),
              })
              if (!repairResponse.ok) {
                // Debugger role failed: fall back to the active model for the
                // remaining attempts instead of aborting the repair loop.
                if (debuggerProvider !== settings.activeProvider || debuggerModel !== settings.activeModel) {
                  toast.warning(`Debugger ${debuggerProvider}:${debuggerModel} gagal (${repairResponse.status}); melanjutkan dengan model aktif.`)
                  debuggerProvider = settings.activeProvider
                  debuggerModel = settings.activeModel
                  continue
                }
                throw new Error(`Auto-repair request failed (${repairResponse.status}).`)
              }
              let repairText = ''
              const repairParser = new AIResponseStreamParser()
              await consumeAIStream(repairResponse, {
                onDelta: delta => {
                  repairText += delta
                  fullText += delta
                  chat.updateMessage(assistantId, { content: fullText })
                  for (const file of repairParser.push(delta)) useFileStore.getState().updateFileContent(file.path, file.content)
                },
              })
              const repairActions = await applyWorkspaceResponse(repairText, currentFiles, instruction => recoverFullFiles(instruction, currentFiles))
              const repairedFiles = repairActions.files
              if (!repairedFiles.length) break
              currentFiles = useFileStore.getState().files
              const previousValidationOutput = validation.output
              validation = await executeWorkspaceCommandWithOutput('npm run build')
              // Never re-run an identical repair: unchanged build output means the
              // previous fix did not move the needle — stop instead of looping.
              if (validation.output === previousValidationOutput) {
                toast.warning('Perbaikan otomatis tidak mengubah hasil build; dihentikan agar tidak mengulang perbaikan yang sama.')
                break
              }
            }
            if (validation.exitCode === 0) toast.success('Build verification passed.')
            else toast.error(`Build still fails after ${repairAttempt} automatic repair attempt(s). Check the terminal output.`)
          }
        } catch (runtimeError) {
          toast.warning(runtimeError instanceof Error ? `Preview or build verification could not complete: ${runtimeError.message}` : 'Preview or build verification could not complete.')
        }
      }
      useConnectionStore.getState().record(settings.activeProvider, settings.activeModel, {
        status: 'success', checkedAt: Date.now(), latency: Date.now() - start, credential,
      })
    } catch (error) {
      const aborted = controller.signal.aborted
      const message = aborted
        ? (fullText ? 'Generation stopped. Your partial response has been kept.' : 'Generation stopped before a response was received.')
        : error instanceof TypeError
          ? 'Connection failed. Check your internet connection and provider availability.'
          : error instanceof Error ? error.message : 'Something went wrong. Please retry.'
      const partialFiles = parser.getFiles()
      if (fullText) chat.updateMessage(assistantId, { interrupted: true, files: partialFiles })
      else chat.removeMessage(assistantId)
      if (!aborted && (!complete || !fullText.trim())) {
        useConnectionStore.getState().record(settings.activeProvider, settings.activeModel, {
          status: 'failed', checkedAt: Date.now(), error: message, credential,
        })
      }
      chat.setError(message)
    } finally {
      toast.dismiss('yuha-agent-stage')
      chat.setStreaming(false)
      abortRef.current = null
    }
  }

  return { ...state, sendMessage, applyFiles, stop: () => abortRef.current?.abort(), clearChat: state.clearMessages }
}
