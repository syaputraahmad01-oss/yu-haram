'use client'

import React, { useEffect, useState } from 'react'
import { Settings2, KeyRound, Check, X, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { PROVIDER_LIST, PROVIDERS } from '@/lib/constants/models'
import { useSettingsStore, type CollaborationMode } from '@/lib/store/useSettingsStore'
import type { ProviderType } from '@/types'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    activeProvider,
    setActiveProvider,
    apiKeys,
    setApiKey,
    removeApiKey,
    collaborationMode,
    setCollaborationMode,
    allowPaidModels,
    setAllowPaidModels,
  } = useSettingsStore()

  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(activeProvider)
  const [keyInput, setKeyInput] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const currentProviderConfig = PROVIDERS[selectedProvider]
  const hasKey = !!apiKeys[selectedProvider]

  const handleSaveKey = () => {
    if (!keyInput.trim()) {
      toast.error('Please enter an API key')
      return
    }
    setApiKey(selectedProvider, keyInput.trim())
    setKeyInput('')
    toast.success(`API key tersimpan terenkripsi untuk ${currentProviderConfig.name}`)
  }

  const handleRemoveKey = () => {
    removeApiKey(selectedProvider)
    toast.info(`API key removed for ${currentProviderConfig.name}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col h-[80vh] w-full max-w-3xl rounded-xl border border-white/10 bg-[#08080c]/95 backdrop-blur-2xl text-slate-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">YUHA Settings & AI Providers</h2>
              <p className="text-xs text-slate-400">Configure credentials for all 6 supported AI providers and budget controls.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Split */}
        <div className="flex flex-1 min-h-0 divide-x divide-slate-800">
          {/* Provider Nav */}
          <div className="w-56 overflow-y-auto p-4 space-y-1.5 bg-[#090d16]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1">
              AI Providers (6)
            </div>
            {PROVIDER_LIST.map(provider => {
              const isSelected = selectedProvider === provider.id
              const hasSavedKey = !!apiKeys[provider.id]
              return (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-xs font-medium transition-colors text-left ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                      style={{ backgroundColor: provider.color }}
                    >
                      {provider.letter}
                    </span>
                    <span>{provider.shortName}</span>
                  </div>
                  {hasSavedKey && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="API Key Configured" />
                  )}
                </button>
              )
            })}

            <div className="pt-4 border-t border-slate-800 mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 px-2 py-1">
                Collaboration Mode
              </div>
              <div className="space-y-1 mt-1">
                {(['economy', 'balanced', 'max'] as CollaborationMode[]).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setCollaborationMode(mode)}
                    className={`w-full text-left rounded-lg px-3 py-1.5 text-xs capitalize ${
                      collaborationMode === mode
                        ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 font-medium'
                        : 'text-slate-400 hover:bg-slate-800/40'
                    }`}
                  >
                    {mode} Mode
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Provider Config Detail */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0b0f19]">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white shadow-sm"
                    style={{ backgroundColor: currentProviderConfig.color }}
                  >
                    {currentProviderConfig.letter}
                  </span>
                  <h3 className="text-base font-semibold text-white">{currentProviderConfig.name}</h3>
                </div>
                {currentProviderConfig.docsUrl && (
                  <a
                    href={currentProviderConfig.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-400 hover:underline"
                  >
                    Get API Key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-400">{currentProviderConfig.description}</p>
            </div>

            {/* API Key Form */}
            <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-blue-400" />
                  API Key Credential
                </label>
                {hasKey ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                    <Check className="h-3.5 w-3.5" /> Key Saved (Encrypted)
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">Not configured</span>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={hasKey ? '••••••••••••••••••••••••' : `Paste your ${currentProviderConfig.shortName} API key`}
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={handleSaveKey}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
                >
                  Save Key
                </button>
                {hasKey && (
                  <button
                    onClick={handleRemoveKey}
                    className="rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-900/30 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                API keys are encrypted with AES-256-GCM before being stored in this browser (the encryption key is device-bound and non-exportable). They are loaded automatically the next time you open YUHA on this device.
              </p>
              {selectedProvider === 'gemini' && <p className="text-[11px] text-amber-300">Google is migrating Gemini API keys to authorization keys in 2026. Create or migrate your key in Google AI Studio if a legacy standard key is rejected. <a className="underline" href="https://ai.google.dev/gemini-api/docs/api-key" target="_blank" rel="noopener noreferrer">Official guidance</a>.</p>}
            </div>

            {/* Free-First Budget Protection Toggle */}
            <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white">Free-First Model Protection</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Block known-paid and unverified-cost models until you explicitly allow them.
                  </p>
                </div>
                <button
                  onClick={() => setAllowPaidModels(!allowPaidModels)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    allowPaidModels ? 'bg-indigo-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      allowPaidModels ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <div className="text-[10px] text-slate-500">
                Status: <strong className={allowPaidModels ? 'text-amber-400' : 'text-emerald-400'}>{allowPaidModels ? 'Paid / unverified models allowed' : 'Verified free only'}</strong>
              </div>
            </div>

            {/* Set as active provider button */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-400">
                Current active provider: <strong className="text-white capitalize">{activeProvider}</strong>
              </span>
              {activeProvider !== selectedProvider && (
                <button
                  onClick={() => {
                    setActiveProvider(selectedProvider)
                    toast.success(`Switched active provider to ${currentProviderConfig.name}`)
                  }}
                  className="rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-200 transition-colors"
                >
                  Set as Active Provider
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-6 py-3 bg-[#0d1322] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
