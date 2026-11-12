'use client'
import { PROVIDER_LIST, PROVIDERS } from '@/lib/constants/models'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { preferredModel, shortModelName, TIER_LABELS } from '@/lib/ai/catalog'
import { ConnectionStatus } from './ConnectionStatus'
import { Button } from '@/components/ui/button'
import { ModelSelect } from './ModelSelect'

export function ProviderSelector() {
  const { activeProvider, activeModel, setActiveProvider, setActiveModel } = useSettingsStore()
  const { models, live } = useModelCatalog(activeProvider)
  const available = models.some(model => model.id === activeModel)
  useEffect(() => { if (!activeModel && live && models.length) { const p = preferredModel(models); if (p) setActiveModel(p.id) } }, [activeModel, live, models, setActiveModel])
  const recommended = preferredModel(models)
  return <>
    <fieldset className="provider-grid" aria-label="Active provider">{PROVIDER_LIST.map(provider => <label key={provider.id} className={cn('provider-option', activeProvider === provider.id && 'active')}><input type="radio" name="active-provider" checked={activeProvider === provider.id} onChange={() => setActiveProvider(provider.id)} value={provider.id} /><span className="provider-letter" style={{ color: provider.color }}>{provider.letter}</span><span>{provider.shortName}</span><span aria-hidden="true" /></label>)}</fieldset>
    <div className="model-select">
      <span>Model default</span>
      <ModelSelect providers={[activeProvider]} variant="settings" />
    </div>
    <div className="active-model-status"><ConnectionStatus provider={activeProvider} model={activeModel} /><span>Status model aktif · hasil pemeriksaan terakhir</span></div>
    {!!activeModel && !available && live && <p className="model-error" role="alert">Model tersimpan tidak ada dalam katalog provider. Pilih model yang tersedia sebelum mencoba kembali.</p>}
    {recommended && recommended.id !== activeModel && <div className="model-recommendation"><div><strong>Rekomendasi sistem</strong><p>{PROVIDERS[activeProvider].name} · {shortModelName(recommended.id)} · {TIER_LABELS[recommended.tier]}</p></div><Button variant="outline" size="sm" onClick={() => setActiveModel(recommended.id)}>Gunakan rekomendasi</Button></div>}
  </>
}
