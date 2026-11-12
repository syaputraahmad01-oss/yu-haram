import { useFileStore } from '@/lib/store/useFileStore'
import { writeFile, deleteFile, runCommand } from '@/lib/webcontainer'
import { parseAIResponseActions, parseSafeNpmCommand, resolveAIResponseWithFallback, type ParsedAIResponse } from '@/lib/ai/parser'
import { toast } from 'sonner'
import type { ParsedFile } from '@/types'

/** Registry/lifecycle config files a MODEL must never write: a malicious
 *  .npmrc can redirect installs to an attacker registry or re-enable
 *  lifecycle scripts. User edits in the editor are unaffected (this gate is
 *  only on the model file-application path). Master Prompt 8.1.5-9. */
const BLOCKED_MODEL_CONFIG_FILES = /^(?:\/)?(?:\.npmrc|\.yarnrc|\.yarnrc\.yml|\.pnpmfile\.cjs)$/i

export async function updateWorkspaceFile(
  path: string,
  content: string,
  options: { syncRuntime?: boolean } = {}
): Promise<void> {
  useFileStore.getState().setFile(path, content)
  if (options.syncRuntime) {
    try {
      await writeFile(path, content)
    } catch {}
  }
}

export async function createWorkspaceFile(
  path: string,
  content: string = '',
  options: { syncRuntime?: boolean } = {}
): Promise<void> {
  await updateWorkspaceFile(path, content, options)
  useFileStore.getState().setActiveFile(path)
}

export async function deleteWorkspacePath(path: string): Promise<void> {
  useFileStore.getState().removeFile(path)
  try {
    await deleteFile(path)
  } catch {}
}

export async function renameWorkspacePath(oldPath: string, newPath: string): Promise<void> {
  useFileStore.getState().renameFile(oldPath, newPath)
  try {
    const content = useFileStore.getState().files[newPath] ?? ''
    await writeFile(newPath, content)
    await deleteFile(oldPath)
  } catch {}
}

export async function applyWorkspaceFiles(files: ParsedFile[]): Promise<void> {
  const blocked: string[] = []
  for (const file of files) {
    if (BLOCKED_MODEL_CONFIG_FILES.test(file.path.trim())) {
      blocked.push(file.path)
      continue
    }
    await updateWorkspaceFile(file.path, file.content, { syncRuntime: true })
  }
  if (blocked.length > 0) {
    toast.error(`File konfigurasi registry ditolak dari output model: ${blocked.join(', ')}. Edit manual di editor bila memang diperlukan (registry resmi npm saja).`)
  }
  const applied = files.filter(file => !blocked.includes(file.path))
  if (applied.length > 0) {
    useFileStore.getState().setActiveFile(applied[0].path)
  }
}

export async function applyWorkspaceResponse(
  raw: string,
  sourceFiles: Record<string, string>,
  requestFullFiles: (instruction: string) => Promise<string>,
): Promise<ParsedAIResponse> {
  const completeFiles = new Map(parseAIResponseActions(raw).files.map(file => [file.path, file.content]))
  let result: ParsedAIResponse
  try {
    result = await resolveAIResponseWithFallback(raw, sourceFiles, requestFullFiles)
  } catch (error) {
    // Full files may already be visible from streaming; undo only those exact
    // generated contents, never a user's newer edit, when recovery fails.
    for (const [path, content] of completeFiles) {
      if (useFileStore.getState().files[path] !== content) continue
      if (Object.hasOwn(sourceFiles, path)) await updateWorkspaceFile(path, sourceFiles[path])
      else useFileStore.getState().removeFile(path)
    }
    throw error
  }
  const currentFiles = useFileStore.getState().files
  for (const file of result.files) {
    const current = currentFiles[file.path]
    if (current !== sourceFiles[file.path] && current !== completeFiles.get(file.path) && current !== file.content) {
      throw new Error(`File ${file.path} berubah selama generasi. Perubahan tidak diterapkan; kirim ulang dengan sumber terbaru.`)
    }
  }
  await applyWorkspaceFiles(result.files)
  return result
}

/** Every execution path funnels here — the executor validates with the SAME
 *  parser as the UI (Master 8.1.2-4: securing the parser alone is not enough).
 *  Fixed internal sequences (install/dev in runProject) call runCommand
 *  directly and are not model-influenced. */
function assertValidatedCommand(executable: string, args: string[]): void {
  const reconstructed = [executable, ...args].join(' ')
  const safe = parseSafeNpmCommand(reconstructed)
  if (!safe || safe.executable !== executable || safe.args.length !== args.length) {
    throw new Error(`Perintah ditolak oleh validasi eksekusi: ${reconstructed.slice(0, 120)}`)
  }
}

export async function executeWorkspaceCommand(
  commandOrCmd: string,
  args?: string[]
): Promise<number> {
  const parts = args ? [commandOrCmd, ...args] : commandOrCmd.split(' ')
  const executable = parts[0]
  const commandArgs = parts.slice(1)
  assertValidatedCommand(executable, commandArgs)
  const proc = await runCommand(executable, commandArgs)
  return await proc.exit
}

export async function executeWorkspaceCommandWithOutput(
  commandOrCmd: string,
  argsOrOnChunk?: string[] | ((data: string) => void),
  onChunk?: (data: string) => void
): Promise<{ exitCode: number; output: string }> {
  let executable: string
  let commandArgs: string[]
  let chunkHandler: ((data: string) => void) | undefined

  if (Array.isArray(argsOrOnChunk)) {
    executable = commandOrCmd
    commandArgs = argsOrOnChunk
    chunkHandler = onChunk
  } else {
    const parts = commandOrCmd.split(' ')
    executable = parts[0]
    commandArgs = parts.slice(1)
    chunkHandler = typeof argsOrOnChunk === 'function' ? argsOrOnChunk : onChunk
  }
  assertValidatedCommand(executable, commandArgs)

  let output = ''
  const proc = await runCommand(executable, commandArgs, chunk => {
    output += chunk
    chunkHandler?.(chunk)
  })
  const exitCode = await proc.exit
  return { exitCode, output }
}
