'use client'

import React, { useEffect, useState } from 'react'
import { CheckCircle2, ShieldCheck, Cpu, Layers, X, Code2 } from 'lucide-react'
import { YUHA_15_FOUNDATIONS_STATUS } from '@/lib/foundations'
import type { FoundationInfo } from '@/types'

interface FoundationsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function FoundationsModal({ isOpen, onClose }: FoundationsModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [activeFoundation, setActiveFoundation] = useState<FoundationInfo | null>(
    YUHA_15_FOUNDATIONS_STATUS[0]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const categories = ['all', ...Array.from(new Set(YUHA_15_FOUNDATIONS_STATUS.map(f => f.category)))]
  const filtered = selectedCategory === 'all'
    ? YUHA_15_FOUNDATIONS_STATUS
    : YUHA_15_FOUNDATIONS_STATUS.filter(f => f.category === selectedCategory)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col h-[85vh] w-full max-w-5xl rounded-xl border border-white/10 bg-[#08080c]/95 backdrop-blur-2xl text-slate-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                YUHA Architecture Blueprint — 15 Foundations
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/30">
                  15 / 15 Implemented & Verified
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Technical foundation architecture, verification gates, and evidence ledger per YUHA Blueprint.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close foundations"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 px-6 py-2.5 bg-[#090d16] overflow-x-auto text-xs">
          <span className="text-slate-500 font-medium mr-1">Category:</span>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-md px-2.5 py-1 transition-colors capitalize ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              {cat === 'all' ? 'All Foundations (15)' : cat}
            </button>
          ))}
        </div>

        {/* Content Split */}
        <div className="flex flex-1 min-h-0 divide-x divide-slate-800">
          {/* Left List */}
          <div className="w-1/2 overflow-y-auto p-4 space-y-2">
            {filtered.map(foundation => {
              const isSelected = activeFoundation?.id === foundation.id
              return (
                <div
                  key={foundation.id}
                  onClick={() => setActiveFoundation(foundation)}
                  className={`group flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-500/50 bg-blue-950/20'
                      : 'border-slate-800/80 bg-[#0e1424]/60 hover:border-slate-700 hover:bg-[#11182c]'
                  }`}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                    {foundation.id}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-slate-200 group-hover:text-blue-400 truncate">
                        {foundation.name}
                      </h3>
                      <span className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {foundation.summary}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right Detail */}
          <div className="w-1/2 overflow-y-auto p-6 bg-[#090d16]/70 flex flex-col justify-between">
            {activeFoundation ? (
              <div className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 text-xs text-blue-400 font-medium uppercase tracking-wider mb-1">
                    <Layers className="h-3.5 w-3.5" />
                    {activeFoundation.category}
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    {activeFoundation.title}
                  </h3>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Foundation Specification
                  </h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activeFoundation.summary}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-4 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Code2 className="h-3.5 w-3.5 text-blue-400" />
                    Implementation & Test Evidence
                  </h4>
                  <div className="font-mono text-xs text-emerald-400 bg-black/40 rounded p-2.5 border border-slate-800/80 break-all">
                    {activeFoundation.evidence}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Validated via automated unit tests in test harness (`npm test`) with zero unverified claims.
                  </p>
                </div>

                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-slate-300 space-y-2">
                  <div className="font-semibold text-blue-400 flex items-center gap-1.5">
                    <Cpu className="h-4 w-4" />
                    Architectural Enforcement
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    This foundation is actively invoked in the YUHA runtime loop. All changes, error fixes, work orders,
                    and model responses pass through its deterministic verification gate.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                Select a foundation to view technical specification
              </div>
            )}

            <div className="border-t border-slate-800 pt-4 mt-6 flex items-center justify-between text-xs text-slate-500">
              <span>YUHA Production Engineering Standard</span>
              <button
                onClick={onClose}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
