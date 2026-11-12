'use client'
import { useEffect, useRef } from 'react'
import { ArrowRight, ArrowUpRight, Braces, CircleHelp, KeyRound, MessageSquare, Plus, WandSparkles, Zap, LayoutDashboard, Kanban } from 'lucide-react'
import { useAIChat } from '@/hooks/useAIChat'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useChatStore } from '@/lib/store/useChatStore'
import { IconButton } from '@/components/layout/IconButton'
import { ChatInput } from './ChatInput'
import { ChatMessage } from './ChatMessage'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store/useAppStore'
export function ChatPanel() {
  const { messages, isStreaming, error, sendMessage, clearChat, stop, applyFiles } = useAIChat()
  const { activeProvider, apiKeys } = useSettingsStore(); const mobilePanel = useAppStore(state => state.mobilePanel)
  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => { if (follow.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages, isStreaming])
  const suggest = (draft: string) => { useChatStore.getState().setDraft(draft); document.getElementById('chat-input')?.focus() }
  return <aside className={cn('chat-panel', mobilePanel !== 'chat' && 'mobile-hidden')} aria-label="Assistant">
    <div className="panel-heading"><div className="panel-heading-title"><MessageSquare /> Assistant <span className="subtle-label">BUILD</span></div><div className="heading-actions"><IconButton label="Clear conversation" disabled={isStreaming || !messages.length} onClick={clearChat}><Plus /></IconButton></div></div>
    <div className="chat-content" ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70 }}>
      {!messages.length ? <div className="chat-welcome"><div className="welcome-logo"><Zap className="welcome-bolt-icon" /></div><span className="welcome-kicker">YUHA HYBRID CLOUD IDE</span><h1>What will you<br />build today?</h1><p>Prompt, run, edit, and ship full-stack web applications with 15 verified architecture foundations.</p><div className="suggestions">
        <button className="suggestion" onClick={() => suggest('Build a modern SaaS landing page with pitch-black glass aesthetics, interactive pricing calculator, and testimonial grid.')}><WandSparkles /><span>SaaS landing page with glass styling</span><ArrowUpRight /></button>
        <button className="suggestion" onClick={() => suggest('Build a real-time Kanban project board with drag-and-drop task cards, tags, and status columns.')}><Kanban /><span>Kanban project management board</span><ArrowUpRight /></button>
        <button className="suggestion" onClick={() => suggest('Build an interactive analytics dashboard with metric KPI cards, trend charts, and an activity log.')}><LayoutDashboard /><span>Analytics dashboard with KPI cards</span><ArrowUpRight /></button>
        <button className="suggestion" onClick={() => suggest('Build a developer portfolio with interactive project showcases, filterable skills, and contact form.')}><Braces /><span>Interactive developer portfolio</span><ArrowUpRight /></button>
      </div><span className="suggestion-caption"><CircleHelp /> Type your idea below or click a template to start.</span></div> : <div className="messages" aria-live="polite" aria-busy={isStreaming}>{messages.map((message, index) => <ChatMessage key={message.id} message={message} streaming={isStreaming && index === messages.length - 1 && message.role === 'assistant'} onApply={applyFiles} />)}</div>}
    </div>
    <div className="chat-bottom">
      {error && (
        <div className="chat-error" role="alert">
          <div>{error}</div>
          <div className="error-actions">
            {messages.some(message => message.role === 'user') && !isStreaming && (
              <button onClick={() => {
                const last = [...messages].reverse().find(message => message.role === 'user')
                if (last) void sendMessage(last.content)
              }}>
                Coba Lagi
              </button>
            )}
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-settings'))}>
              Pilih Model Gratis Lain
            </button>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-settings'))}>
              Setujui / Atur Model Berbayar
            </button>
            <button type="button" onClick={() => useChatStore.getState().setError(null)}>Tutup</button>
          </div>
        </div>
      )}
      {!apiKeys[activeProvider] && (
        <div className="key-notice">
          <KeyRound />
          <p>
            Your workspace. Your models.<br />
            <button
              type="button"
              className="text-blue-400 hover:underline inline-flex items-center gap-1 font-medium"
              onClick={() => window.dispatchEvent(new CustomEvent('yuha:open-settings'))}
            >
              Connect a provider in Settings <ArrowRight className="h-3 w-3 inline" />
            </button>
          </p>
        </div>
      )}
      <ChatInput sendMessage={sendMessage} stop={stop} />
    </div>
  </aside>
}
