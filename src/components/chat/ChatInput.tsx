'use client'
import { useRef } from 'react'
import { ArrowUp, CornerDownLeft, LoaderCircle, Paperclip, Square, WandSparkles } from 'lucide-react'
import { useChatStore } from '@/lib/store/useChatStore'
import { useFiles } from '@/hooks/useFiles'
import { ModelSelect } from '@/components/settings/ModelSelect'
import { IconButton } from '@/components/layout/IconButton'
import { toast } from 'sonner'
export function ChatInput({ sendMessage, stop }: { sendMessage: (content: string) => Promise<void>; stop: () => void }) {
  const { draft, setDraft, isStreaming } = useChatStore(); const inputRef = useRef<HTMLInputElement>(null); const { createFile } = useFiles()
  const submit = () => { if (draft.trim() && !isStreaming) void sendMessage(draft) }
  return <>
    <div className="composer"><textarea id="chat-input" aria-label="Describe what you want to build" placeholder="Describe your next big idea..." value={draft} onChange={event => { setDraft(event.target.value); event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight, 190) + 'px' }} maxLength={100000} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} />
      <div className="composer-toolbar"><IconButton label="Add a file to your project" onClick={() => inputRef.current?.click()} disabled={isStreaming}><Paperclip /></IconButton><IconButton label="Add design guidelines to your prompt" disabled={isStreaming} onClick={() => { setDraft(draft + '\n\nUse a cohesive color palette, refined typography, responsive layouts, and accessible interactions.'); document.getElementById('chat-input')?.focus() }}><WandSparkles /></IconButton><div className="composer-model"><span className="provider-spark" aria-hidden="true">✦</span><ModelSelect /></div><button type="button" className="send-button" onClick={isStreaming ? stop : submit} disabled={!draft.trim() && !isStreaming} aria-label={isStreaming ? 'Stop generation' : 'Send message'}>{isStreaming ? <Square /> : <ArrowUp />}</button></div>
    </div>
    <input ref={inputRef} type="file" className="sr-only" aria-label="Import project file" accept=".tsx,.ts,.jsx,.js,.json,.html,.css,.md,.txt,.svg" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 500000) { toast.error('Please choose a file smaller than 500 KB.'); return } try { createFile(file.name, await file.text()); toast.success(`${file.name} added to project context`) } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not import this file.') } event.target.value = '' }} />
    <div className="composer-caption"><span>{isStreaming ? <><LoaderCircle className="animate-spin" /> Building your idea</> : <>A little direction goes a long way.</>}</span><span><kbd>Shift</kbd> + <CornerDownLeft /> new line</span></div>
  </>
}
