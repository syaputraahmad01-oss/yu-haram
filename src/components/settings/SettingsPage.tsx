'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  DollarSign,
  Info,
  KeyRound,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users2,
} from 'lucide-react'
import { Brand } from '@/components/layout/Brand'
import { ProviderSelector } from './ProviderSelector'
import { ResearchSettings } from './ResearchSettings'
import { ProviderCard } from './ProviderCard'
import { useModelCatalog } from '@/hooks/useModelCatalog'
import { shortModelName, TIER_LABELS } from '@/lib/ai/catalog'
import { PROVIDER_LIST } from '@/lib/constants/models'
import { useAppStore } from '@/lib/store/useAppStore'
import { useSettingsStore, type AgentRole } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import type { ProviderType } from '@/types'

export default function SettingsPage() {
  const theme = useAppStore(state => state.theme)
  const geminiCatalog = useModelCatalog('gemini')
  const groqCatalog = useModelCatalog('groq')
  const openrouterCatalog = useModelCatalog('openrouter')
  const {
    collaborationMode,
    setCollaborationMode,
    allowPaidModels,
    setAllowPaidModels,
    roleModels,
    setRoleModel,
    activeProvider,
  } = useSettingsStore()

  useEffect(() => {
    document.documentElement.className =
      document.documentElement.className.replace(/\b(dark|light)\b/g, '') + ' ' + theme
  }, [theme])

  const save = () => toast.success('Preferensi tersimpan di browser; API key tersimpan terenkripsi (AES-256) dan otomatis dimuat kembali saat Anda kembali.')
  const roleModelOptions = [
    { provider: 'gemini' as const, models: geminiCatalog.models },
    { provider: 'groq' as const, models: groqCatalog.models },
    { provider: 'openrouter' as const, models: openrouterCatalog.models },
  ].flatMap(({ provider, models }) => models
    .filter(model => allowPaidModels || model.tier === 'free' || model.tier === 'free-tier')
    .map(model => ({ provider, model })))

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <Link href="/workspace" aria-label="YUHA workspace">
          <Brand />
        </Link>
        <Link href="/workspace" className="back-link">
          <ArrowLeft /> Back to workspace
        </Link>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings navigation">
          <span>WORKSPACE</span>
          <a className="active" href="#providers"><KeyRound /> Providers & keys</a>
          <a href="#cost-protection"><DollarSign /> Proteksi Biaya (Free-First)</a>
          <a href="#roles"><Users2 /> Model Peran (Roles)</a>
          <a href="#preferences"><SlidersHorizontal /> Orchestration & Theme</a>
          <Link href="/workspace"><Code2 /> Back to building</Link>
        </nav>

        <main className="settings-content">
          <div className="settings-kicker">PRINSIP UTAMA: FREE-FIRST & KONTROL PENUH PENGGUNA</div>
          <h1>AI Providers & Model Control</h1>
          <p className="settings-subtitle">
            YUHA didesain untuk berjalan dengan <strong>tiga provider utama</strong>: Google Gemini, Groq, dan OpenRouter.
            <br />
            Model dengan status gratis yang dapat diverifikasi diprioritaskan. Model dengan biaya belum terverifikasi tidak dipilih otomatis untuk peran pendukung; model utama tetap mengikuti pilihan eksplisit Anda.
          </p>

          {/* Banner Free-First */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-foreground flex items-start gap-3 mb-6">
            <Sparkles className="size-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-emerald-400 font-semibold">Kebijakan Bebas Biaya Otomatis (Free-First):</strong>
              <p className="text-xs text-muted-foreground mt-1">
                YUHA tidak akan otomatis memilih model yang diketahui berbayar atau memiliki biaya belum terverifikasi untuk peran pendukung saat proteksi biaya aktif. Varian OpenRouter berpenanda <code>:free</code> dan model lokal yang teridentifikasi diprioritaskan. Label gratis tidak dibuat hanya dari nama keluarga model.
              </p>
            </div>
          </div>

          {/* Section 1: Active Provider */}
          <section className="settings-section" id="providers">
            <div className="settings-section-header">
              <h2>Provider Aktif & Pilihan Model</h2>
              <span>Tiga Provider Inti</span>
            </div>
            <ProviderSelector />
            <p className="model-catalog-note">
              Katalog model diambil langsung secara dinamis dari endpoint resmi provider. Status harga, batas kuota, dan ketersediaan mengikuti ketentuan akun Anda.
            </p>
          </section>

          {/* Section 2: Provider Connections */}
          <div className="settings-section-header">
            <h2>Koneksi & Kunci API</h2>
            <span>Tersimpan Terenkripsi AES-256 di Browser</span>
          </div>
          {PROVIDER_LIST.map(provider => (
            <ProviderCard config={provider} key={provider.id} />
          ))}

          {/* Privacy Note */}
          <div className="privacy-note">
            <ShieldCheck />
            <p>
              <strong>Kunci API tetap milik Anda.</strong> Kunci dienkripsi AES-256-GCM sebelum disimpan di penyimpanan browser lokal; kunci enkripsinya terikat pada perangkat ini (IndexedDB, non-ekspor) sehingga salinan localStorage saja tidak cukup untuk membaca kredensial Anda. Request cloud dikirim melalui server aplikasi langsung ke API resmi provider melalui HTTPS tanpa pencatatan token rahasia ke log.
            </p>
          </div>

          {/* Section 3: Cost Protection & Paid Models */}
          <section id="cost-protection" className="settings-section">
            <div className="settings-section-header">
              <h2>Proteksi Biaya & Model Berbayar</h2>
              <span>Aturan Mutlak Anti Biaya Tersembunyi</span>
            </div>

            <div className="rounded-xl border border-white/10 bg-card p-5 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <ShieldAlert className="size-4 text-amber-400" />
                    Izinkan Model Berbayar / Biaya Belum Terverifikasi
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                    Opsi ini mengizinkan pemilihan model utama yang berbayar/biayanya belum terverifikasi dan mengizinkan peran pendukung memakai model berbiaya tersebut bila model gratis terverifikasi tidak tersedia. Model utama tetap harus Anda pilih secara eksplisit; peran pendukung dapat memakai fallback otomatis setelah izin ini diaktifkan.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={allowPaidModels ? 'destructive' : 'default'} className={!allowPaidModels ? 'bg-emerald-600' : ''}>
                    {allowPaidModels ? 'Berbayar Diizinkan' : 'Mode Gratis Saja'}
                  </Badge>
                  <Switch
                    checked={allowPaidModels}
                    onCheckedChange={checked => {
                      setAllowPaidModels(checked)
                      if (checked) {
                        toast.warning('Model berbayar atau berbiaya belum terverifikasi diizinkan; periksa billing provider Anda.')
                      } else {
                        toast.success('Proteksi aktif: model berbayar/biaya tidak terverifikasi diblokir untuk model utama dan peran pendukung.')
                      }
                    }}
                  />
                </div>
              </div>

              <div className="rounded-lg bg-black/20 p-3 text-xs text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-400 shrink-0" />
                <span>
                  Jika kuota model gratis habis atau terkena rate limit (429), sistem akan menampilkan dialog peringatan untuk mencoba lagi atau memilih model gratis lain, bukan diam-diam mengenakan biaya.
                </span>
              </div>
            </div>
          </section>

          {/* Section 4: Role-Based Model Assignment */}
          <section id="roles" className="settings-section">
            <div className="settings-section-header">
              <h2>Pengaturan Model Khusus Peran</h2>
              <span>Planner · Coder · Reviewer · Debugger</span>
            </div>

            <div className="rounded-xl border border-white/10 bg-card p-5 space-y-4">
              <p className="text-xs text-muted-foreground">
                Tentukan model khusus dari katalog live untuk setiap tahapan agen. Dalam mode proteksi biaya, hanya model dengan status gratis yang terverifikasi yang dapat dipilih sebagai peran pendukung.
              </p>

              {(['planner', 'coder', 'reviewer', 'debugger'] as AgentRole[]).map(role => {
                const current = roleModels[role]
                const label = role === 'planner'
                  ? 'Perencana (Planner) — Menyusun rencana tugas'
                  : role === 'coder'
                    ? 'Pelaksana (Coder) — Menulis kode dan file'
                    : role === 'reviewer'
                      ? 'Peninjau (Reviewer) — Memeriksa kualitas kode independen'
                      : 'Debugger — Model untuk perbaikan build otomatis setelah pemeriksaan lokal'

                return (
                  <div key={role} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white/5">
                    <div>
                      <div className="text-sm font-medium capitalize flex items-center gap-2">
                        <span>{role}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{current ? `${current.provider}: ${current.model}` : 'Otomatis (Free-First)'}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        className="rounded-md border border-white/10 bg-background px-3 py-1.5 text-xs text-foreground"
                        value={current ? `${current.provider}:${current.model}` : 'auto'}
                        onChange={e => {
                          const val = e.target.value
                          if (val === 'auto') {
                            setRoleModel(role, activeProvider, '')
                          } else {
                            const separator = val.indexOf(':')
                            const provider = val.slice(0, separator) as ProviderType
                            const model = val.slice(separator + 1)
                            if (separator < 1 || !model) return
                            setRoleModel(role, provider, model)
                          }
                          toast.success(`Pengaturan peran ${role} diperbarui.`)
                        }}
                      >
                        <option value="auto">Default Otomatis (Free-First Terverifikasi)</option>
                        {current && !roleModelOptions.some(option => option.provider === current.provider && option.model.id === current.model) && (
                          <option value={`${current.provider}:${current.model}`}>Pilihan tersimpan · {current.provider} · {shortModelName(current.model)} (belum terverifikasi)</option>
                        )}
                        {roleModelOptions.map(({ provider, model }) => (
                          <option key={`${provider}:${model.id}`} value={`${provider}:${model.id}`}>
                            {provider} · {shortModelName(model.id)} ({TIER_LABELS[model.tier]})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Section: Web Research */}
          <section id="web-research" className="settings-section">
            <div className="settings-section-header">
              <h2>Web Research Engine</h2>
              <span>Tavily · Brave · SerpAPI · Exa · SearXNG · DuckDuckGo · Firecrawl</span>
            </div>
            <ResearchSettings />
          </section>

          {/* Section 5: AI Collaboration & Appearance */}
          <section id="preferences" className="settings-section">
            <div className="settings-section-header">
              <h2>Mode Kolaborasi Multi-Model</h2>
              <span>Economy · Balanced · Max</span>
            </div>

            <div className="max-w-xl rounded-xl border p-4 space-y-2">
              <label htmlFor="collaboration-mode" className="text-sm font-medium">Collaboration mode</label>
              <select
                id="collaboration-mode"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={collaborationMode}
                onChange={event => setCollaborationMode(event.target.value as 'economy' | 'balanced' | 'max')}
              >
                <option value="economy">Economy — Satu model utama (Hemat kuota)</option>
                <option value="balanced">Balanced — Planner + Coder (Direkomendasikan)</option>
                <option value="max">Max — Planner + Coder + Reviewer Independen</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Semua mode mematuhi prinsip <strong>Free-First</strong> untuk peran pendukung. Model tambahan hanya digunakan jika provider memiliki kunci dan model yang lolos pemeriksaan biaya; model berbayar atau biaya yang belum terverifikasi memerlukan persetujuan pada proteksi biaya.
              </p>
              <div className="rounded-lg bg-black/20 p-3 text-xs text-muted-foreground border border-white/5 space-y-1 mt-2">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Info className="size-3.5 text-blue-400" /> Catatan Privasi & Pengiriman Multi-Provider:
                </span>
                <p>
                  Pada <strong>Mode Seimbang (Balanced)</strong> dan <strong>Maksimal (Max)</strong>, berkas proyek dikirim ke penyedia model perencana (Planner) dan peninjau (Reviewer) yang berbeda dari model utama agar evaluasi dan dekomposisi tugas bersifat independen.
                </p>
              </div>
            </div>

            <div className="settings-section-header mt-6">
              <h2>Tampilan (Appearance)</h2>
            </div>
            <Button variant="outline" size="sm" onClick={() => useAppStore.getState().toggleTheme()}>
              <Settings2 data-icon="inline-start" />
              {theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
            </Button>
          </section>

          <footer className="settings-footer">
            <span className="flex items-center gap-1.5">
              <Check className="size-3" /> Pengaturan disimpan langsung di browser lokal Anda.
            </span>
            <Button onClick={save}>
              <Save data-icon="inline-start" /> Simpan Pengaturan
            </Button>
          </footer>
        </main>
      </div>
    </div>
  )
}
