'use client'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, FileCode2, Sparkles, UserRound } from 'lucide-react'
import type { AIMessage, ParsedFile } from '@/types'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/layout/IconButton'
import { toast } from 'sonner'

/**
 * Message timestamps render client-side only (mounted gate).
 *
 * Why: the SSR pass and the browser evaluate `new Date()` at different moments
 * (server module init vs page load) and format them in different locales
 * (Node en-US/UTC vs the user's, e.g. id-ID/WITA). `suppressHydrationWarning`
 * hides the console noise, but React deliberately leaves the suppressed
 * server value in the DOM ("This won't be patched up") — a user in Indonesia
 * got a frozen UTC boot-time stamp in en-US format that never corrected
 * itself. Returning null until mount makes the SSR markup deterministic
 * (no <time> node at all), so nothing can mismatch; the user then sees their
 * own locale and timezone. The flag stays as defence in depth for future
 * regressions.
 */
function MessageTime({ timestamp }: { timestamp: number }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  const date = new Date(timestamp)
  return <time dateTime={date.toISOString()} suppressHydrationWarning>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
}

export function ChatMessage({ message, streaming, onApply }: { message: AIMessage; streaming: boolean; onApply: (files: ParsedFile[]) => Promise<void> }) {
  return <article className={cn('message', message.role)}>
    <div className="message-heading"><span className="message-avatar">{message.role === 'assistant' ? <Sparkles /> : <UserRound />}</span>{message.role === 'assistant' ? 'YUHA' : 'You'}<MessageTime timestamp={message.timestamp} />{message.content && <IconButton label="Copy message" onClick={() => { void navigator.clipboard.writeText(message.content).then(() => toast.success('Message copied')).catch(() => toast.error('Clipboard is unavailable.')) }}><Copy /></IconButton>}</div>
    <div className="message-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.content}</ReactMarkdown>{streaming && <span className="streaming-cursor" aria-label="Generating" />}</div>
    {message.files && message.files.length > 0 && <div className="message-files">{message.files.map(file => <div className="generated-file" key={file.path}><FileCode2 /><span>{file.path}</span><button onClick={() => { void onApply([file]).catch(error => toast.error(error.message)) }}>Apply to editor</button></div>)}</div>}
    {message.interrupted && message.content && <span className="stream-interrupted">Generation interrupted · partial response preserved</span>}
  </article>
}
