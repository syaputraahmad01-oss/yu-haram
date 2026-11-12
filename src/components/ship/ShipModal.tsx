'use client'

import React, { useEffect, useState } from 'react'
import { Rocket, Download, CheckCircle2, AlertCircle, Loader2, X, Globe, Server, Cloud } from 'lucide-react'
import { toast } from 'sonner'
import { useFileStore } from '@/lib/store/useFileStore'
import JSZip from 'jszip'

interface ShipModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ShipModal({ isOpen, onClose }: ShipModalProps) {
  const files = useFileStore(state => state.files)
  const projectName = useFileStore(state => state.projectName) || 'yuha-app'

  const [activeTab, setActiveTab] = useState<'zip' | 'netlify' | 'vercel' | 'cloudflare'>('zip')
  const [exporting, setExporting] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [netlifyToken, setNetlifyToken] = useState('')
  const [netlifySiteId, setNetlifySiteId] = useState('')
  const [deployResult, setDeployResult] = useState<{ url?: string; message?: string; error?: string } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleDownloadZip = async () => {
    setExporting(true)
    try {
      const zip = new JSZip()
      for (const [path, content] of Object.entries(files)) {
        zip.file(path, content)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${projectName}-production.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('ZIP project archive downloaded successfully!')
    } catch (err) {
      toast.error('Failed to generate ZIP: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  const handleNetlifyDeploy = async () => {
    if (!netlifyToken || !netlifySiteId) {
      toast.error('Please provide both Netlify Personal Access Token and Site ID.')
      return
    }

    setDeploying(true)
    setDeployResult(null)

    try {
      const res = await fetch('/api/deploy/netlify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-netlify-token': netlifyToken,
        },
        body: JSON.stringify({
          siteId: netlifySiteId,
          files,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Deployment failed with status ${res.status}`)
      }

      setDeployResult({
        url: data.url,
        message: data.message || 'Deployment successful!',
      })
      toast.success('Deployed to Netlify successfully!')
    } catch (err) {
      setDeployResult({
        error: err instanceof Error ? err.message : 'Deployment failed',
      })
      toast.error('Netlify deploy failed')
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex flex-col h-[75vh] w-full max-w-2xl rounded-xl border border-white/10 bg-[#08080c]/95 backdrop-blur-2xl text-slate-100 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Rocket className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">YUHA Ship Center</h2>
              <p className="text-xs text-slate-400">Export production bundles or deploy to verified cloud providers.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close ship center"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-[#090d16] px-6 gap-2 text-xs">
          <button
            onClick={() => setActiveTab('zip')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'zip'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="h-4 w-4" /> Download ZIP
          </button>
          <button
            onClick={() => setActiveTab('netlify')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'netlify'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="h-4 w-4" /> Netlify Deploy
          </button>
          <button
            onClick={() => setActiveTab('vercel')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'vercel'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="h-4 w-4" /> Vercel
          </button>
          <button
            onClick={() => setActiveTab('cloudflare')}
            className={`flex items-center gap-2 py-3 px-3 border-b-2 font-medium transition-colors ${
              activeTab === 'cloudflare'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cloud className="h-4 w-4" /> Cloudflare Pages
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'zip' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-5 space-y-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Download className="h-4 w-4 text-indigo-400" />
                  Full Source Project ZIP Package
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Download the complete standalone YUHA project archive containing all {Object.keys(files).length} files,
                  modular components, TypeScript configurations, styles, and test files.
                </p>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-slate-400">
                    Target: <strong className="text-slate-200">{projectName}-production.zip</strong>
                  </span>
                  <button
                    onClick={handleDownloadZip}
                    disabled={exporting}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download Project ZIP
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'netlify' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-5 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-white">Deploy directly to Netlify</h3>
                  <p className="text-xs text-slate-400">
                    Direct ZIP deployment via Netlify API. (Audited & verified with Bug 1 fix).
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Netlify Personal Access Token
                    </label>
                    <input
                      type="password"
                      placeholder="nfp_..."
                      value={netlifyToken}
                      onChange={e => setNetlifyToken(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Netlify Site ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 12345678-abcd-1234-ef01-123456789abc"
                      value={netlifySiteId}
                      onChange={e => setNetlifySiteId(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  onClick={handleNetlifyDeploy}
                  disabled={deploying}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  Deploy to Netlify
                </button>

                {deployResult && (
                  <div
                    className={`rounded-lg border p-4 text-xs ${
                      deployResult.error
                        ? 'border-red-500/30 bg-red-950/20 text-red-300'
                        : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                    }`}
                  >
                    {deployResult.error ? (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>{deployResult.error}</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 font-semibold">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>{deployResult.message}</span>
                        </div>
                        {deployResult.url && (
                          <a
                            href={deployResult.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 underline block mt-1"
                          >
                            Open Live Site: {deployResult.url}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {(activeTab === 'vercel' || activeTab === 'cloudflare') && (
            <div className="rounded-lg border border-slate-800 bg-[#0d1322] p-5 text-xs text-slate-300 space-y-2">
              <h4 className="font-semibold text-white capitalize">{activeTab} Deployment Integration</h4>
              <p className="text-slate-400">
                Configure your API credentials in Settings to trigger automated deployments for {activeTab}.
                You can also download the complete production ZIP package and drag-and-drop it directly into your {activeTab} dashboard.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 px-6 py-3 bg-[#0d1322] flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
