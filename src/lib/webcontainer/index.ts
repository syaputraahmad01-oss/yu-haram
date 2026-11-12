'use client'

import type { WebContainer, WebContainerProcess } from '@webcontainer/api'
import type { FileMap } from '@/types'
import { useAppStore } from '@/lib/store/useAppStore'
import { useFileStore } from '@/lib/store/useFileStore'
import { useTerminalStore } from '@/lib/store/useTerminalStore'
import { safePath } from '@/lib/utils/file-helpers'
import { injectPreviewDiagnosticsBridge } from '@/lib/runtime/diagnostics'

let instance: WebContainer | null = null
let bootPromise: Promise<WebContainer> | null = null
let devProcess: WebContainerProcess | null = null
let runPromise: Promise<void> | null = null
let installedPackageJson: string | null = null
const mountedPaths = new Set<string>()
const readyWaiters = new Set<{ resolve: (url: string) => void; reject: (error: Error) => void }>()

export function currentContainer(): WebContainer | null {
  return instance
}

function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to start the browser runtime.'
}

function settleReadyWaiters(error?: Error, url?: string) {
  for (const waiter of readyWaiters) {
    if (error) waiter.reject(error)
    else if (url) waiter.resolve(url)
  }
  readyWaiters.clear()
}

export async function getWebContainer(): Promise<WebContainer> {
  if (instance) return instance
  if (!globalThis.crossOriginIsolated) {
    throw new Error('The browser runtime needs cross-origin isolation. Open YUHA in a standalone tab on an HTTPS deployment with COOP/COEP headers.')
  }

  if (!bootPromise) {
    useAppStore.getState().setRuntime({ isBooting: true, runtimeStatus: 'booting', runtimeError: null })
    bootPromise = import('@webcontainer/api')
      .then(({ WebContainer }) => WebContainer.boot({ coep: 'credentialless' }))
      .then(container => {
        instance = container
        container.on('server-ready', (_port, url) => {
          useAppStore.getState().setServerUrl(url)
          useAppStore.getState().setRuntime({ isBooting: false, webcontainerReady: true, runtimeStatus: 'ready', runtimeError: null })
          useTerminalStore.getState().setStatus('ready')
          settleReadyWaiters(undefined, url)
        })
        useAppStore.getState().setRuntime({ isBooting: false, webcontainerReady: true, runtimeStatus: 'idle', runtimeError: null })
        return container
      })
      .catch(error => {
        bootPromise = null
        instance = null
        const message = runtimeErrorMessage(error)
        useAppStore.getState().setRuntime({ isBooting: false, runtimeStatus: 'error', runtimeError: message })
        useTerminalStore.getState().setStatus('error')
        useTerminalStore.getState().addDiagnostic(message, 'runtime')
        useTerminalStore.getState().appendLine(`\r\n${message}\r\n`)
        throw error
      })
  }
  return bootPromise
}

export async function writeFile(path: string, content: string): Promise<void> {
  if (!instance) return
  const clean = safePath(path)
  if (!clean) throw new Error(`Rejected unsafe workspace path: ${path}`)
  const parent = clean.split('/').slice(0, -1).join('/')
  if (parent) await instance.fs.mkdir(parent, { recursive: true })
  await instance.fs.writeFile(clean, content)
  mountedPaths.add(clean)
}

export async function mountFiles(files: FileMap): Promise<void> {
  const container = await getWebContainer()
  const safeFiles: FileMap = {}
  for (const [path, content] of Object.entries(files)) {
    const cleanPath = safePath(path)
    if (!cleanPath) throw new Error(`Rejected unsafe workspace path: ${path}`)
    safeFiles[cleanPath] = cleanPath === 'index.html' ? injectPreviewDiagnosticsBridge(content) : content
  }

  for (const previous of [...mountedPaths]) {
    if (Object.hasOwn(safeFiles, previous)) continue
    await container.fs.rm(previous, { force: true, recursive: true })
    mountedPaths.delete(previous)
  }

  for (const [path, content] of Object.entries(safeFiles)) {
    const parent = path.split('/').slice(0, -1).join('/')
    if (parent) await container.fs.mkdir(parent, { recursive: true })
    await container.fs.writeFile(path, typeof content === 'string' ? content : String(content))
    mountedPaths.add(path)
  }
}

export async function deleteFile(path: string): Promise<void> {
  const clean = safePath(path)
  if (!clean) throw new Error(`Rejected unsafe workspace path: ${path}`)
  if (instance) await instance.fs.rm(clean, { recursive: true, force: true })
  for (const mounted of [...mountedPaths]) {
    if (mounted === clean || mounted.startsWith(clean + '/')) mountedPaths.delete(mounted)
  }
}

export async function runCommand(command: string, args: string[] = [], onOutput?: (data: string) => void): Promise<WebContainerProcess> {
  const container = await getWebContainer()
  const process = await container.spawn(command, args)
  void process.output.pipeTo(new WritableStream<string>({
    write: data => {
      useTerminalStore.getState().appendLine(data)
      onOutput?.(data)
    },
  })).catch(() => {
    // Process output streams can close as part of normal process shutdown.
  })
  return process
}

function waitForServerReady(timeoutMs = 90_000): Promise<string> {
  const currentUrl = useAppStore.getState().serverUrl
  if (currentUrl) return Promise.resolve(currentUrl)

  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject }
    const timeout = setTimeout(() => {
      readyWaiters.delete(waiter)
      reject(new Error('The development server did not become ready in time. Check the terminal output.'))
    }, timeoutMs)
    readyWaiters.add({
      resolve: url => { clearTimeout(timeout); readyWaiters.delete(waiter); resolve(url) },
      reject: error => { clearTimeout(timeout); readyWaiters.delete(waiter); reject(error) },
    })
  })
}

const approvedPackages = new Set<string>()

function extractPackageNames(packageJsonContent: string): string[] {
  try {
    const parsed = JSON.parse(packageJsonContent) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    return [
      ...Object.keys(parsed.dependencies || {}),
      ...Object.keys(parsed.devDependencies || {}),
    ]
  } catch {
    return []
  }
}

async function installDependencies(files: FileMap): Promise<void> {
  const packageJson = files['package.json']
  if (!packageJson) throw new Error('This project has no package.json and cannot be started with npm run dev.')
  if (installedPackageJson === packageJson) return

  const currentPackages = extractPackageNames(packageJson)
  const newPackages = currentPackages.filter(pkg => !approvedPackages.has(pkg))

  if (newPackages.length > 0) {
    const approved = await useAppStore.getState().requestConfirmation({
      title: 'Konfirmasi Pemasangan Dependensi Baru',
      description: `Model AI mengusulkan pemasangan ${newPackages.length} paket dependensi baru:`,
      packages: newPackages,
    })
    if (!approved) {
      useTerminalStore.getState().appendLine('\r\nPemasangan dependensi dibatalkan oleh pengguna.\r\n')
      throw new Error('Pemasangan dependensi baru ditolak oleh pengguna.')
    }
    for (const pkg of newPackages) approvedPackages.add(pkg)
  }

  useAppStore.getState().setRuntime({ isBooting: true, runtimeStatus: 'installing', runtimeError: null })
  useTerminalStore.getState().setStatus('installing')
  useTerminalStore.getState().appendLine('\r\n$ npm install --ignore-scripts\r\n')
  const install = await runCommand('npm', ['install', '--ignore-scripts'])
  const exitCode = await install.exit
  if (exitCode !== 0) throw new Error(`Dependency installation exited with code ${exitCode}. Check the terminal output.`)
  installedPackageJson = packageJson
}

export async function runProject(files: FileMap = useFileStore.getState().files): Promise<void> {
  // Coalesce clicks while a boot/install/start sequence is already in flight.
  if (runPromise) return runPromise

  runPromise = (async () => {
    const app = useAppStore.getState()
    app.setRuntime({ isBooting: true, runtimeStatus: 'booting', runtimeError: null })
    app.setServerUrl(null)
    useTerminalStore.getState().setRunning(true)
    useTerminalStore.getState().setStatus('booting')
    useTerminalStore.getState().appendLine('\r\nStarting browser runtime...\r\n')

    try {
      const container = await getWebContainer()
      if (devProcess) {
        devProcess.kill()
        devProcess = null
      }
      await mountFiles(files)
      await installDependencies(files)

      useAppStore.getState().setRuntime({ isBooting: true, runtimeStatus: 'starting', runtimeError: null })
      useTerminalStore.getState().setStatus('starting')
      useTerminalStore.getState().appendLine('\r\n$ npm run dev\r\n')
      const started = await container.spawn('npm', ['run', 'dev'])
      devProcess = started
      void started.output.pipeTo(new WritableStream<string>({
        write: data => useTerminalStore.getState().appendLine(data),
      })).catch(() => {
        // Output stream closure is expected when the dev process exits or is stopped.
      })
      void started.exit.then(exitCode => {
        useTerminalStore.getState().appendLine(`\r\nDevelopment server stopped (${exitCode}).\r\n`)
        if (devProcess !== started) return
        devProcess = null
        useAppStore.getState().setServerUrl(null)
        const wasReady = useAppStore.getState().runtimeStatus === 'ready'
        useAppStore.getState().setRuntime({
          isBooting: false,
          runtimeStatus: wasReady ? 'idle' : 'error',
          runtimeError: wasReady ? null : 'The development server exited before becoming ready. Check the terminal output.',
        })
        useTerminalStore.getState().setRunning(false)
        useTerminalStore.getState().setStatus(wasReady ? 'idle' : 'error')
        if (!wasReady) {
          const message = 'The development server exited before becoming ready. Check the terminal output.'
          useTerminalStore.getState().addDiagnostic(message, 'runtime')
          settleReadyWaiters(new Error(message))
        }
      }).catch(() => {
        // The process exit promise is surfaced through the runtime status and terminal output.
      })

      await waitForServerReady()
      useAppStore.getState().setRuntime({ isBooting: false, runtimeStatus: 'ready', runtimeError: null })
      useTerminalStore.getState().setRunning(true)
      useTerminalStore.getState().setStatus('ready')
    } catch (error) {
      const message = runtimeErrorMessage(error)
      useAppStore.getState().setServerUrl(null)
      useAppStore.getState().setRuntime({ isBooting: false, runtimeStatus: 'error', runtimeError: message })
      useTerminalStore.getState().setRunning(false)
      useTerminalStore.getState().setStatus('error')
      useTerminalStore.getState().addDiagnostic(message, 'runtime')
      useTerminalStore.getState().appendLine(`\r\n${message}\r\n`)
      settleReadyWaiters(new Error(message))
      throw error
    } finally {
      if (useAppStore.getState().runtimeStatus !== 'ready') useTerminalStore.getState().setRunning(false)
    }
  })().finally(() => { runPromise = null })

  return runPromise
}

export async function stopProject(): Promise<void> {
  useAppStore.getState().setRuntime({ isBooting: true, runtimeStatus: 'stopping', runtimeError: null })
  useTerminalStore.getState().setStatus('stopping')
  settleReadyWaiters(new Error('The preview startup was stopped.'))
  devProcess?.kill()
  devProcess = null
  useAppStore.getState().setServerUrl(null)
  useAppStore.getState().setRuntime({ isBooting: false, runtimeStatus: 'idle', runtimeError: null })
  useTerminalStore.getState().setRunning(false)
  useTerminalStore.getState().setStatus('idle')
}
