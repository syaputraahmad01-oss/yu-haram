import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AIMessage } from '@/types'

interface ChatState {
  messages: AIMessage[]
  isStreaming: boolean
  error: string | null
  statusNotice: string | null
  draft: string
  setDraft: (draft: string) => void
  addMessage: (msg: Omit<AIMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void
  updateMessage: (id: string, updates: Partial<AIMessage>) => void
  removeMessage: (id: string) => void
  updateLastAssistantMessage: (updater: (prev: string) => string) => void
  setStreaming: (isStreaming: boolean) => void
  setError: (error: string | null) => void
  setStatusNotice: (notice: string | null) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [
        {
          id: 'welcome-1',
          role: 'assistant',
          content: 'Halo! Saya YUHA. Apa yang ingin Anda bangun hari ini? Berikan deskripsi aplikasi atau komponen yang Anda butuhkan.',
          timestamp: Date.now(),
        },
      ],
      isStreaming: false,
      error: null,
      statusNotice: null,
      draft: '',
      setDraft: draft => set({ draft }),
      addMessage: msg =>
        set(state => ({
          messages: [
            ...state.messages,
            {
              role: msg.role,
              content: msg.content,
              files: msg.files,
              interrupted: msg.interrupted,
              id: msg.id ?? 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              timestamp: msg.timestamp ?? Date.now(),
            },
          ],
        })),
      updateMessage: (id, updates) =>
        set(state => ({
          messages: state.messages.map(m => (m.id === id ? { ...m, ...updates } : m)),
        })),
      removeMessage: id =>
        set(state => ({
          messages: state.messages.filter(m => m.id !== id),
        })),
      updateLastAssistantMessage: updater =>
        set(state => {
          const msgs = [...state.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
              msgs[i] = {
                ...msgs[i],
                content: updater(msgs[i].content),
              }
              break
            }
          }
          return { messages: msgs }
        }),
      setStreaming: isStreaming => set({ isStreaming }),
      setError: error => set({ error }),
      setStatusNotice: statusNotice => set({ statusNotice }),
      clearMessages: () =>
        set({
          messages: [
            {
              id: 'welcome-' + Date.now(),
              role: 'assistant',
              content: 'Proyek baru telah dimulai. Apa yang ingin kita rancang selanjutnya?',
              timestamp: Date.now(),
            },
          ],
          error: null,
          statusNotice: null,
          draft: '',
        }),
    }),
    {
      name: 'yuha-chat-storage',
      skipHydration: true,
      version: 1,
      // Only durable conversation state may survive a reload. Transient flags such as
      // isStreaming must never be persisted: a page reload or tab close in the middle of
      // a generation used to freeze `isStreaming: true` in localStorage, which silently
      // blocked every subsequent send (the composer stayed in "Building your idea").
      partialize: state => ({ messages: state.messages, draft: state.draft }),
      migrate: persisted => {
        const legacy = (persisted ?? {}) as Partial<ChatState>
        return {
          messages: Array.isArray(legacy.messages) ? legacy.messages : [],
          draft: typeof legacy.draft === 'string' ? legacy.draft : '',
        }
      },
      onRehydrateStorage: () => state => {
        // Defense in depth: stale persisted data from the pre-v1 format may still carry
        // transient flags; force-clear them after hydration.
        state?.setStreaming(false)
        state?.setError(null)
        state?.setStatusNotice(null)
      },
    }
  )
)
