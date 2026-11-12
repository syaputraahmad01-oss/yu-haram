'use client'
/**
 * Web Research settings (Master Prompt 9.4): keys, enable/disable, fallback
 * order, result limit, SearXNG endpoint, auto-research toggle, connection
 * tests. Keys live in the encrypted settings store and are NEVER echoed back
 * after save (password inputs), never logged, never sent to other providers.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Globe, KeyRound, RefreshCw, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { RESEARCH_PROVIDERS, type ResearchProviderId } from '@/lib/research/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const SEARCH_ORDER_PROVIDER_IDS = ['tavily', 'brave', 'serpapi', 'exa', 'searxng', 'duckduckgo'] as const

export function ResearchSettings() {
  const research = useSettingsStore(state => state.research)
  const setResearchConfig = useSettingsStore(state => state.setResearchConfig)
  const [testing, setTesting] = useState<ResearchProviderId | null>(null)

  const setKey = (provider: ResearchProviderId, key: string) => {
    setResearchConfig({ keys: { ...research.keys, [provider]: key } })
  }

  const toggleEnabled = (provider: ResearchProviderId) => {
    setResearchConfig({ enabled: { ...research.enabled, [provider]: research.enabled[provider] === false } })
  }

  const move = (provider: ResearchProviderId, direction: -1 | 1) => {
    const order = [...research.order]
    const index = order.indexOf(provider)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    setResearchConfig({ order })
  }

  const testProvider = async (provider: ResearchProviderId) => {
    if (testing) return
    setTesting(provider)
    try {
      const key = research.keys[provider] ?? ''
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (key) headers[`x-yuha-research-key-${provider}`] = key
      const response = await fetch('/api/research', {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'test', provider, searxngBaseUrl: provider === 'searxng' ? research.searxngBaseUrl : undefined }),
        signal: AbortSignal.timeout(30_000),
      })
      const payload = await response.json() as { status?: string; error?: string }
      if (response.ok && payload.status === 'success') toast.success(`${RESEARCH_PROVIDERS[provider].name}: koneksi berhasil.`)
      else toast.error(`${RESEARCH_PROVIDERS[provider].name}: ${payload.error ?? 'koneksi gagal'}`)
    } catch (error) {
      toast.error(`${RESEARCH_PROVIDERS[provider].name}: ${error instanceof Error ? error.message : 'koneksi gagal'}`)
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xl rounded-xl border p-4 space-y-2">
        <label className="text-sm font-medium flex items-center gap-2">
          <input
            type="checkbox"
            checked={research.autoResearch}
            onChange={event => setResearchConfig({ autoResearch: event.target.checked })}
          />
          Riset web otomatis saat instruksi memerlukan informasi terkini
        </label>
        <p className="text-xs text-muted-foreground">
          Ketika aktif, YUHA mendeteksi niat (berita, dokumentasi terbaru, analisis pasar) dan mengumpulkan sumber web SEBELUM generasi. Konten web diperlakukan sebagai data tidak tepercaya dan tidak pernah dapat mengubah instruksi sistem. Tanpa key yang tersimpan, riset dilewati dengan pemberitahuan.
        </p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Globe className="size-3.5" />
          <label className="flex items-center gap-2">
            Maks hasil:
            <Input
              type="number" min={1} max={10} value={research.maxResults}
              onChange={event => setResearchConfig({ maxResults: Math.min(Math.max(Number(event.target.value) || 5, 1), 10) })}
              className="w-16 h-7"
            />
          </label>
        </div>
      </div>

      {/* Search provider order */}
      <div className="rounded-xl border p-4 space-y-3">
        <h3 className="text-sm font-semibold">Urutan Fallback Pencarian</h3>
        <p className="text-xs text-muted-foreground">Provider gagal (kuota/rate limit/outage) → query berlanjut ke provider berikutnya. Hasil digabung, dideduplikasi, dan diberi sitasi.</p>
        <ul className="space-y-2">
          {SEARCH_ORDER_PROVIDER_IDS.map(provider => {
            const meta = RESEARCH_PROVIDERS[provider]
            const orderIndex = research.order.indexOf(provider)
            const enabled = research.enabled[provider] !== false
            return (
              <li key={provider} className={cn('rounded-lg border p-3 space-y-2', enabled ? '' : 'opacity-50')}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground w-5">{orderIndex >= 0 ? orderIndex + 1 : '–'}</span>
                  <strong className="text-sm">{meta.name}</strong>
                  <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5">{meta.role === 'extraction' ? 'ekstraksi' : 'pencarian'}</span>
                  <label className="flex items-center gap-1.5 text-xs ml-auto">
                    <input type="checkbox" checked={enabled} onChange={() => toggleEnabled(provider)} />
                    {enabled ? 'aktif' : 'nonaktif'}
                  </label>
                  <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={`Naikkan ${meta.name}`} onClick={() => move(provider, -1)}><ArrowUp className="size-3.5" /></Button>
                  <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={`Turunkan ${meta.name}`} onClick={() => move(provider, 1)}><ArrowDown className="size-3.5" /></Button>
                </div>
                <p className="text-xs text-muted-foreground">{meta.capabilityNote}</p>
                {meta.needsKey ? (
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
                    <Input
                      type="password" autoComplete="off"
                      placeholder={research.keys[provider] ? '•••• tersimpan (ketik untuk ganti)' : `API key ${meta.name}`}
                      value={research.keys[provider] ?? ''}
                      onChange={event => setKey(provider, event.target.value)}
                      className="h-8 text-xs"
                    />
                    <Button variant="outline" size="sm" disabled={testing !== null} onClick={() => { void testProvider(provider) }}>
                      {testing === provider ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                      Tes
                    </Button>
                  </div>
                ) : provider === 'searxng' ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="url" placeholder="https://searxng.anda.example"
                      value={research.searxngBaseUrl}
                      onChange={event => setResearchConfig({ searxngBaseUrl: event.target.value.trim() })}
                      className="h-8 text-xs"
                    />
                    <Button variant="outline" size="sm" disabled={testing !== null} onClick={() => { void testProvider(provider) }}>
                      {testing === provider ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                      Tes
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={testing !== null} onClick={() => { void testProvider(provider) }}>
                      {testing === provider ? <RefreshCw className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                      Tes
                    </Button>
                    <span className="text-xs text-muted-foreground">Tanpa API key (Instant Answer resmi).</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Firecrawl extraction */}
      <div className="rounded-xl border p-4 space-y-2">
        <h3 className="text-sm font-semibold">Ekstraksi Konten (Firecrawl)</h3>
        <p className="text-xs text-muted-foreground">{RESEARCH_PROVIDERS.firecrawl.capabilityNote} Key tersimpan terenkripsi; konten halaman dibingkai sebagai data tidak tepercaya.</p>
        <div className="flex items-center gap-2">
          <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
          <Input
            type="password" autoComplete="off"
            placeholder={research.keys.firecrawl ? '•••• tersimpan (ketik untuk ganti)' : 'API key Firecrawl (fc-…)'}
            value={research.keys.firecrawl ?? ''}
            onChange={event => setKey('firecrawl', event.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  )
}
