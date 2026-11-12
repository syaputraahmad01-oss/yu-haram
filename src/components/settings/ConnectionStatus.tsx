'use client'
import { Badge } from '@/components/ui/badge'
import { Check, CircleHelp, LoaderCircle, X } from 'lucide-react'
import { useConnectionStore } from '@/lib/store/useConnectionStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { ProviderType } from '@/types'

export function ConnectionStatus({ provider, model }: { provider: ProviderType; model: string }) {
  const credential = useSettingsStore(state => state.apiKeys[provider] || '')
  const saved = useConnectionStore(state => state.results[`${provider}:${model}`])
  const result = saved?.credential === credential ? saved : undefined
  return <span role="status" className="model-connection" title={result?.checkedAt ? `Diperiksa ${new Date(result.checkedAt).toLocaleString()}. Status terakhir, bukan pemantauan langsung.` : undefined}>
    <Badge variant={result?.status === 'failed' ? 'destructive' : 'outline'}>
      {result?.status === 'testing' ? <><LoaderCircle data-icon="inline-start" className="animate-spin" />Menguji</> : result?.status === 'success' ? <><Check data-icon="inline-start" />Berhasil{result.latency != null ? ` · ${result.latency} ms` : ''}</> : result?.status === 'failed' ? <><X data-icon="inline-start" />Gagal</> : <><CircleHelp data-icon="inline-start" />Belum diuji</>}
    </Badge>
  </span>
}
