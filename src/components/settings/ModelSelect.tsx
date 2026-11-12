'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { PROVIDER_LIST, PROVIDERS } from '@/lib/constants/models'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { modelOption, shortModelName, TIER_LABELS, type ModelOption, type ModelTier } from '@/lib/ai/catalog'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { confirmModelCost } from './model-cost-consent'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { ConnectionStatus } from './ConnectionStatus'
import { cn } from '@/lib/utils'
import type { ProviderType } from '@/types'

/** Compact badge labels for the picker; long labels live in TIER_LABELS. */
const TIER_BADGE: Record<ModelTier, { label: string; className: string }> = {
  free: { label: 'Gratis', className: 'mp-badge-free' },
  'free-tier': { label: 'Kuota', className: 'mp-badge-free-tier' },
  paid: { label: 'Berbayar', className: 'mp-badge-paid' },
  unknown: { label: 'Cek biaya', className: 'mp-badge-unknown' },
}

const IDLE_GROUP_LIMIT = 5

type Variant = 'composer' | 'settings'

export function ModelSelect({
  providers,
  variant = 'composer',
}: {
  /** Restrict the picker to specific providers (Settings passes only the active one). */
  providers?: ProviderType[]
  variant?: Variant
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { activeProvider, activeModel, setActiveProvider, setActiveModel } = useSettingsStore()

  const geminiCatalog = useModelCatalog('gemini')
  const groqCatalog = useModelCatalog('groq')
  const openrouterCatalog = useModelCatalog('openrouter')
  const ollamaCatalog = useModelCatalog('ollama')
  const kimiCatalog = useModelCatalog('kimi')
  const qwenCatalog = useModelCatalog('qwen')
  const catalogMap: Record<ProviderType, typeof geminiCatalog> = {
    gemini: geminiCatalog,
    groq: groqCatalog,
    openrouter: openrouterCatalog,
    ollama: ollamaCatalog,
    kimi: kimiCatalog,
    qwen: qwenCatalog,
  }

  const scoped = providers ?? PROVIDER_LIST.map(provider => provider.id)
  const groups = scoped
    .map(id => ({ config: PROVIDERS[id], models: catalogMap[id].models }))
    .filter(group => group.models.length > 0)
  // A provider with a saved key whose catalog failed used to disappear from the
  // picker without any explanation — surface the failure instead.
  const failedGroups = scoped
    .map(id => ({ config: PROVIDERS[id], error: catalogMap[id].error as Error | undefined, credential: catalogMap[id].credential as string | undefined }))
    .map(({ config, error, credential }) => ({ config, credential, message: error?.message ?? '' }))
    .filter(({ config, message, credential }) => !!message && (config.id === 'openrouter' || config.id === 'ollama' || !!credential))
  const anyModels = groups.length > 0
  const idle = query.trim() === ''
  // Providers that could load a catalog once a key is saved (openrouter lists
  // keyless, ollama runs local). Shown as a hint instead of empty groups.
  const keyless = scoped.filter(id => id !== 'openrouter' && id !== 'ollama' && !catalogMap[id].credential)

  const activeCatalog = catalogMap[activeProvider].models
  const savedMissing = !!activeModel && !activeCatalog.some(model => model.id === activeModel)
  const activeTier = activeModel ? modelOption(activeProvider, activeModel).tier : null

  // Free-first quick picks: the active provider's free models first, then one
  // or two from every other configured provider.
  const isFree = (model: ModelOption) => model.tier === 'free' || model.tier === 'free-tier'
  const quickPicks = [
    ...groups.filter(group => group.config.id === activeProvider)
      .flatMap(group => group.models.filter(isFree).slice(0, 3).map(model => ({ provider: group.config.id, model }))),
    ...groups.filter(group => group.config.id !== activeProvider)
      .flatMap(group => group.models.filter(isFree).slice(0, 2).map(model => ({ provider: group.config.id, model }))),
  ].slice(0, 6)

  const choose = (provider: ProviderType, modelId: string) => {
    // Same Free-First consent flow as Settings: a paid or pricing-unverified
    // model requires an explicit user action before it becomes active.
    const catalog = catalogMap[provider]
    const model = catalog.models.find(entry => entry.id === modelId)
      ?? { id: modelId, name: modelId, provider, tier: 'unknown' as const }
    confirmModelCost(model, provider, () => {
      if (provider !== activeProvider) setActiveProvider(provider)
      setActiveModel(modelId)
      setOpen(false)
    })
  }

  // Reset the search whenever the popover closes, whether by selection, Escape
  // or an outside click. A controlled Radix open state does not fire
  // onOpenChange for programmatic closes, so this must be an effect.
  useEffect(() => { if (!open) setQuery('') }, [open])

  /** Idle view caps each group; the active model is always kept visible. */
  const visibleModels = (provider: ProviderType, models: ModelOption[]) => {
    if (!idle) return models
    const capped = models.slice(0, IDLE_GROUP_LIMIT)
    if (activeProvider === provider && activeModel) {
      const selected = models.find(model => model.id === activeModel)
      if (selected && !capped.some(model => model.id === selected.id)) return [...capped, selected]
    }
    return capped
  }

  const renderModelItem = (provider: ProviderType, model: ModelOption, saved = false) => {
    const selected = activeProvider === provider && activeModel === model.id
    const badge = saved
      ? { label: 'Tersimpan', className: 'mp-badge-unknown' }
      : TIER_BADGE[model.tier]
    return (
      <CommandItem
        key={`${provider}:${saved ? 'saved:' : ''}${model.id}`}
        value={`${provider}:${model.id}`}
        keywords={[model.id, shortModelName(model.id), PROVIDERS[provider].name, badge.label]}
        onSelect={() => choose(provider, model.id)}
      >
        <span className="mp-check" aria-hidden="true">{selected ? <Check /> : null}</span>
        <span className="mp-name" title={model.id}>{shortModelName(model.id)}</span>
        <span className={cn('mp-badge', badge.className)}>{badge.label}</span>
        {!saved && model.contextWindow ? <span className="mp-meta">{Math.round(model.contextWindow / 1000)}k</span> : null}
      </CommandItem>
    )
  }

  const triggerTierDot = activeTier ? <span className={cn('mp-dot', `mp-dot-${activeTier}`)} title={TIER_LABELS[activeTier]} /> : null

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn('model-picker-trigger', variant === 'composer' ? 'composer-model-select' : 'is-block')}
        aria-label="Pilih provider dan model AI"
      >
        <span className="mp-letter" style={{ color: PROVIDERS[activeProvider].color }} aria-hidden="true">
          {PROVIDERS[activeProvider].letter}
        </span>
        <span className="mp-trigger-name">{activeModel ? shortModelName(activeModel) : 'Pilih model'}</span>
        {triggerTierDot}
        {variant === 'composer' ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent
        className="model-picker-popover"
        side={variant === 'composer' ? 'top' : 'bottom'}
        align={variant === 'composer' ? 'end' : 'start'}
        sideOffset={6}
        collisionPadding={12}
      >
        <Command>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Cari model… (mis. flash, llama, free)" />
          <CommandList>
            <CommandEmpty>Tidak ada model yang cocok. Coba kata kunci lain.</CommandEmpty>

            {!anyModels && (
              <div className="mp-empty">
                <strong>Belum ada katalog model.</strong>
                <p>Simpan API key di <Link href="/settings">Settings</Link>, lalu buka kembali pemilih model ini.</p>
              </div>
            )}

            {anyModels && idle && savedMissing && activeModel && (
              <CommandGroup
                heading={<><span className="mp-letter" style={{ color: PROVIDERS[activeProvider].color }} aria-hidden="true">{PROVIDERS[activeProvider].letter}</span>Model tersimpan</>}
              >
                {renderModelItem(activeProvider, { id: activeModel, name: activeModel, provider: activeProvider, tier: activeTier ?? 'unknown' }, true)}
              </CommandGroup>
            )}

            {anyModels && idle && quickPicks.length > 0 && (
              <CommandGroup heading={<><Sparkles aria-hidden="true" />Gratis · pilihan cepat</>}>
                {quickPicks.map(({ provider, model }) => renderModelItem(provider, model))}
              </CommandGroup>
            )}

            {anyModels && failedGroups.length > 0 && (
              <div className="mp-keys-hint" role="alert">
                Katalog gagal dimuat: {failedGroups.map(({ config, message }) => `${config.shortName} — ${message}`).join(' · ')}. Buka Settings untuk memperbarui katalog.
              </div>
            )}

            {anyModels && groups.map(({ config, models }) => {
              const visible = visibleModels(config.id, models)
              return (
              <CommandGroup
                key={config.id}
                heading={<><span className="mp-letter" style={{ color: config.color }} aria-hidden="true">{config.letter}</span>{config.name}<span className="mp-count">{models.length}</span></>}
              >
                {visible.map(model => renderModelItem(config.id, model))}
                {idle && models.length > visible.length && (
                  <div className="mp-more">+{models.length - visible.length} lainnya — ketik untuk mencari semua</div>
                )}
              </CommandGroup>
              )
            })}
          </CommandList>
          {anyModels && idle && keyless.length > 0 && (
            <div className="mp-keys-hint">Model lain tersedia setelah API key {keyless.map(id => PROVIDERS[id].shortName).join(', ')} disimpan di Settings.</div>
          )}
          <div className="mp-footer">
            <Link href="/settings">Kelola API key &amp; model</Link>
            <span>Gratis diprioritaskan</span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
    {variant === 'composer' && (
      <span className="composer-connection"><ConnectionStatus provider={activeProvider} model={activeModel} /></span>
    )}
  </>
}
