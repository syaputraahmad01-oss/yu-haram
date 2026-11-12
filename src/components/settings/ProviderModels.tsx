'use client'
import { useState } from 'react'
import { RefreshCw, Sparkles, Zap } from 'lucide-react'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { testModelConnection } from '@/lib/ai/test-connection'
import { useConnectionStore } from '@/lib/store/useConnectionStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { formatModelPricing, generationWorksKeyless, catalogListsKeyless, TIER_LABELS, type ModelOption } from '@/lib/ai/catalog'
import { confirmModelCost } from './model-cost-consent'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { ConnectionStatus } from './ConnectionStatus'
import type { ProviderType } from '@/types'
import { toast } from 'sonner'

export function ProviderModels({ provider }: { provider: ProviderType }) {
  const { models, live, credential, error, isValidating, mutate } = useModelCatalog(provider)
  const results = useConnectionStore(state => state.results)
  const { activeProvider, activeModel, setActiveProvider, setActiveModel } = useSettingsStore()
  const [pending, setPending] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState('all')
  const [expanded, setExpanded] = useState(false)
  // Ollama runs locally and answers without a credential; cloud providers need a saved key.
  const canTest = !!credential || generationWorksKeyless(provider)

  const handleTest = async (model: ModelOption) => {
    if (pending) return
    setPending(model.id)
    try { await testModelConnection(provider, model.id, credential) }
    finally { setPending(null) }
  }

  const handleSelectModel = (model: ModelOption) => {
    // Shared Free-First consent flow (identical rules to the composer picker).
    // proceed() runs only after consent (or when the model is verified free).
    confirmModelCost(model, provider, () => {
      setActiveProvider(provider)
      setActiveModel(model.id)
      if (model.tier === 'unknown') {
        toast.warning(`Biaya ${model.id} belum dapat diverifikasi dari katalog provider. Periksa paket dan billing akun Anda sebelum menggunakannya.`, { duration: 6500 })
      } else {
        toast.success(`Model ${model.id} dipilih sebagai model aktif (${TIER_LABELS[model.tier]}).`)
      }
    })
  }

  const filtered = models.filter(model => {
    const matchesQuery = model.id.toLowerCase().includes(query.toLowerCase()) || (model.name && model.name.toLowerCase().includes(query.toLowerCase()))
    if (!matchesQuery) return false
    if (tier === 'all') return true
    if (tier === 'free') return model.tier === 'free' || model.tier === 'free-tier'
    if (tier === 'paid') return model.tier === 'paid'
    if (tier === 'unknown') return model.tier === 'unknown'
    return true
  })

  const visible = expanded || query ? filtered : filtered.slice(0, 8)

  return (
    <div className="provider-models">
      <div className="model-catalog-head">
        <div>
          <strong className="text-sm font-semibold">Katalog Model Dinamis & Pengujian</strong>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isValidating
              ? 'Mengambil katalog model langsung dari endpoint provider…'
              : live
                ? `${models.length} model terdeteksi dari ${provider} · Prioritas: Model Gratis (Free-First)`
                : credential || catalogListsKeyless(provider)
                  ? 'Katalog belum termuat — klik Perbarui Katalog untuk mengambil dari endpoint provider.'
                  : 'Simpan API key lalu klik Perbarui untuk memuat katalog dinamis'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isValidating || !canTest && !catalogListsKeyless(provider)}
          onClick={() => { void mutate().catch(() => {}) }}
        >
          <RefreshCw data-icon="inline-start" className={isValidating ? 'animate-spin' : undefined} />
          Perbarui Katalog
        </Button>
      </div>

      {error && <p className="model-error" role="alert">Katalog gagal diperbarui: {error.message}</p>}

      <div className="model-filters">
        <Field>
          <FieldLabel htmlFor={`${provider}-search`}>Cari model</FieldLabel>
          <Input
            id={`${provider}-search`}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Cari nama atau id model (misal: flash, llama, free)…"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${provider}-tier`}>Filter Status Biaya</FieldLabel>
          <select
            id={`${provider}-tier`}
            className="model-cost-select"
            value={tier}
            onChange={event => setTier(event.target.value)}
          >
            <option value="all">Semua Model ({models.length})</option>
            <option value="free">Hanya Gratis / Kuota Pengembang</option>
            <option value="paid">Hanya Model Berbayar</option>
            <option value="unknown">Biaya Belum Diverifikasi</option>
          </select>
        </Field>
      </div>

      <ul className="provider-model-list" aria-label={`Daftar model ${provider}`}>
        {visible.map(model => {
          const result = results[`${provider}:${model.id}`]
          const failed = result?.credential === credential && result.status === 'failed'
          const selected = activeProvider === provider && activeModel === model.id
          const isFree = model.tier === 'free' || model.tier === 'free-tier'

          return (
            <li key={model.id} className={selected ? 'model-row selected' : 'model-row'}>
              <div className="model-row-main">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="font-semibold text-foreground text-xs">{model.id}</code>
                  <Badge
                    variant={model.tier === 'free' ? 'default' : model.tier === 'free-tier' ? 'secondary' : model.tier === 'paid' ? 'outline' : 'secondary'}
                    className={model.tier === 'free' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : model.tier === 'free-tier' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : model.tier === 'paid' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : ''}
                  >
                    {TIER_LABELS[model.tier]}
                  </Badge>
                  {model.recommended && (
                    <Badge variant="outline" className="text-xs">
                      <Sparkles data-icon="inline-start" className="size-3 mr-1 text-primary" />
                      {model.recommended}
                    </Badge>
                  )}
                  <ConnectionStatus provider={provider} model={model.id} />
                </div>

                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                  <span>{formatModelPricing(model)}</span>
                  {model.contextWindow ? <span>· Context: {(model.contextWindow / 1000).toFixed(0)}k token</span> : null}
                  {model.outputTokenLimit ? <span>· Max Output: {model.outputTokenLimit}</span> : null}
                </div>

                {model.description && (
                  <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">{model.description}</p>
                )}
                {failed && <p className="model-error mt-1" role="alert">{result.error}</p>}
              </div>

              <div className="model-row-actions">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canTest || !!pending}
                  onClick={() => { void handleTest(model) }}
                  aria-label={`Tes koneksi ${model.id}`}
                >
                  {pending === model.id ? 'Menguji…' : <><Zap data-icon="inline-start" />Tes</>}
                </Button>
                <Button
                  variant={selected ? 'secondary' : isFree ? 'default' : 'ghost'}
                  size="sm"
                  disabled={selected}
                  onClick={() => handleSelectModel(model)}
                  aria-label={`Gunakan ${model.id}`}
                >
                  {selected ? 'Aktif' : 'Pilih'}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      {!filtered.length && (
        <p className="model-catalog-note text-center py-4">
          Tidak ada model pada kategori ini. Perbarui katalog atau ubah filter.
        </p>
      )}

      {!expanded && !query && filtered.length > visible.length && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          Tampilkan semua {filtered.length} model
        </Button>
      )}

      <p className="model-catalog-note">
        <strong>Aturan Biaya YUHA:</strong> Model berlabel GRATIS atau Kuota Pengembang diprioritaskan. YUHA tidak akan pernah otomatis berpindah ke model berbayar tanpa persetujuan eksplisit Anda.
      </p>
    </div>
  )
}
