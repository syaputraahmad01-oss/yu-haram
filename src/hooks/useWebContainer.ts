'use client'

import { useCallback, useState } from 'react'
import { useAppStore } from '@/lib/store/useAppStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { runProject, stopProject } from '@/lib/webcontainer'
import { toast } from 'sonner'

export function useWebContainer() {
  const isBooting = useAppStore(state => state.isBooting)
  const webcontainerReady = useAppStore(state => state.webcontainerReady)
  const serverUrl = useAppStore(state => state.serverUrl)
  const runtimeError = useAppStore(state => state.runtimeError)
  const runtimeStatus = useAppStore(state => state.runtimeStatus)
  const [isStarting, setIsStarting] = useState(false)

  const boot = useCallback(async () => {
    if (isStarting || isBooting) return
    setIsStarting(true)
    try {
      await runProject(useFileStore.getState().files)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the runtime.')
    } finally {
      setIsStarting(false)
    }
  }, [isBooting, isStarting])

  const stop = useCallback(async () => {
    await stopProject()
  }, [])

  return {
    isBooting: isBooting || isStarting,
    isReady: webcontainerReady,
    serverUrl,
    error: runtimeError,
    status: runtimeStatus,
    boot,
    restart: boot,
    stop,
  }
}
