'use client'
import { useEffect } from 'react'
import { useChatStore } from '@/lib/store/useChatStore'
import { useConnectionStore } from '@/lib/store/useConnectionStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { useHistoryStore } from '@/lib/store/useHistoryStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/**
 * Rehydrates all persisted zustand stores after mount.
 * Stores use `skipHydration: true` so that the first client render always
 * matches the server-rendered markup (prevents React hydration mismatches
 * when localStorage holds a previous session). Persisted state is applied
 * immediately after hydration completes.
 */
export function StoreHydrator() {
  useEffect(() => {
    void useChatStore.persist.rehydrate()
    void useConnectionStore.persist.rehydrate()
    void useFileStore.persist.rehydrate()
    void useHistoryStore.persist.rehydrate()
    void useSettingsStore.persist.rehydrate()
  }, [])
  return null
}
