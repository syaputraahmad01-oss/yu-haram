'use client'
import { useState } from 'react'
import { ArrowUpRight, Check, Trash2 } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { maskKey } from '@/lib/utils/encryption'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/layout/IconButton'
import { ApiKeyField } from './ApiKeyField'
import { ProviderModels } from './ProviderModels'
import type { ProviderConfig } from '@/types'
import { toast } from 'sonner'
export function ProviderCard({ config }: { config: ProviderConfig }) {
  const { apiKeys, getApiKey, setApiKey, removeApiKey } = useSettingsStore()
  const [draft, setDraft] = useState(''); const [visible, setVisible] = useState(false)
  const saved = !!apiKeys[config.id]
  const save = () => { if (draft.trim().length < 8) { toast.error('Please enter a valid API key, at least 8 characters long.'); return } try { setApiKey(config.id, draft); setDraft(''); setVisible(false); toast.success(`${config.name} key tersimpan terenkripsi (AES-256) di browser ini`) } catch { toast.error('Unable to activate this API key.') } }
  return <section className="provider-card" aria-label={`${config.name} configuration`}><div className="provider-card-head"><span className="provider-letter" style={{ color: config.color }}>{config.letter}</span><div><div className="provider-card-name">{config.name}</div><div className="provider-card-description">{config.description}</div>{config.id === 'gemini' && <p className="text-xs text-muted-foreground mt-1">Google changed Gemini API key authentication in 2026. If an older standard key fails, create/migrate to an authorization key and restrict it to the Gemini API. <a href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noopener noreferrer">Official guidance</a>.</p>}</div><a href={config.docsUrl} target="_blank" rel="noopener noreferrer">Get API key<ArrowUpRight /></a></div>
    <><div className="provider-key-row"><ApiKeyField id={`${config.id}-key`} value={draft} onChange={setDraft} placeholder={saved ? maskKey(getApiKey(config.id)) : config.id === 'gemini' ? 'Paste your Gemini API key' : 'Paste your API key'} visible={visible} onToggle={() => { if (!draft && saved) setDraft(getApiKey(config.id)); setVisible(!visible) }} /><Button variant="outline" size="sm" onClick={save} disabled={!draft.trim()}>Save key</Button>{saved && <IconButton label={`Delete ${config.name} key`} onClick={() => { removeApiKey(config.id); setDraft(''); setVisible(false); toast.success('API key removed from this browser') }}><Trash2 /></IconButton>}</div>{saved && <div className="saved-key"><Check />{maskKey(getApiKey(config.id))}<span> · Tersimpan terenkripsi di browser ini</span></div>}</>
    <ProviderModels provider={config.id} />
  </section>
}
