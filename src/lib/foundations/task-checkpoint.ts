/**
 * Pass 13 Phase 3 + Master Prompt PHASE 2: Task checkpoint store.
 *
 * Every orchestration task carries a resumable checkpoint so a failing Coder
 * does NOT restart the whole project from scratch:
 *  - Stable work ID bound to the WORKSPACE, not just the instruction
 *  - schemaVersion + integrity checksum (validated before resume)
 *  - TTL so stale checkpoints cannot be resumed forever
 *  - Per-stage status, file manifest with SHA-256 revisions
 *  - Execution logs, previous model output, failure reason
 *
 * Storage: JSON files under `.data/checkpoints/` (nodejs runtime filesystem),
 * atomic writes (temp file + rename). A FAILED checkpoint write NEVER aborts
 * orchestration — the caller degrades to non-persistent mode with a notice
 * (Master Prompt 5.13/14: no misclassification as timeout, no data loss).
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const CHECKPOINT_SCHEMA_VERSION = 2
/** Checkpoints older than this are expired and never resumed. */
export const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface TaskCheckpointEntry {
  taskId: string
  title: string
  objective: string
  acceptanceCriteria: string[]
  status: 'completed' | 'pending' | 'failed'
  changedFiles: string[]
  completedAt?: number
}

export interface TaskCheckpoint {
  /** Stable key: workspace + normalized instruction + primary model. */
  checkpointKey: string
  schemaVersion: number
  /** Identity scope: a retry in another workspace never resumes this work. */
  workspaceId: string
  taskId: string
  projectId: string
  sessionId: string
  originalInstruction: string
  status: 'running' | 'completed' | 'interrupted' | 'waiting_for_user'
  tasks: TaskCheckpointEntry[]
  /** path → sha256 of last known-good content. */
  fileManifest: Record<string, string>
  lastValidChanges: string[]
  previousModelOutput: string
  failureReason?: string
  executionLogs: string[]
  createdAt: number
  updatedAt: number
  expiresAt: number
  /** SHA-256 of the core fields; a mismatch invalidates the checkpoint. */
  checksum: string
}

const CHECKPOINT_DIR = resolve(process.cwd(), '.data/checkpoints')

function safeKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 40)
}

function checkpointPath(key: string): string {
  return join(CHECKPOINT_DIR, `${safeKey(key)}.json`)
}

export function deriveCheckpointKey(instruction: string, provider: string, model: string, workspaceId = 'default'): string {
  const normalized = instruction.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 2000)
  return `${workspaceId}:${provider}:${model}:${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** Integrity checksum over the fields that define resumable identity. */
export function checkpointChecksum(checkpoint: Omit<TaskCheckpoint, 'checksum'>): string {
  const core = JSON.stringify([
    checkpoint.checkpointKey, checkpoint.schemaVersion, checkpoint.workspaceId,
    checkpoint.originalInstruction, checkpoint.status, checkpoint.tasks,
    checkpoint.fileManifest, checkpoint.lastValidChanges,
  ])
  return createHash('sha256').update(core).digest('hex').slice(0, 32)
}

export function buildFileManifest(files: Record<string, string>): Record<string, string> {
  const manifest: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    if (typeof content === 'string') manifest[path] = hashContent(content)
  }
  return manifest
}

export async function saveCheckpoint(checkpoint: TaskCheckpoint): Promise<void> {
  const target = checkpointPath(checkpoint.checkpointKey)
  const payload = JSON.stringify({ ...checkpoint, updatedAt: Date.now() }, null, 2)
  await mkdir(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temp, payload, 'utf8')
  await rename(temp, target)
}

export interface LoadedCheckpoint {
  checkpoint: TaskCheckpoint
  /** Why a checkpoint was rejected, when it was. */
  rejectedBecause?: 'expired' | 'checksum_mismatch' | 'schema_version'
}

export async function loadCheckpoint(checkpointKey: string): Promise<TaskCheckpoint | null> {
  const loaded = await loadCheckpointDetailed(checkpointKey)
  return loaded ? loaded.checkpoint : null
}

/** Detailed loader: validates TTL, schema version and integrity checksum
 *  BEFORE the caller may resume from the checkpoint. */
export async function loadCheckpointDetailed(checkpointKey: string): Promise<LoadedCheckpoint | null> {
  try {
    const raw = await readFile(checkpointPath(checkpointKey), 'utf8')
    const parsed = JSON.parse(raw) as TaskCheckpoint
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) return null
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) return { checkpoint: parsed, rejectedBecause: 'expired' }
    if (parsed.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return { checkpoint: parsed, rejectedBecause: 'schema_version' }
    const { checksum, ...rest } = parsed
    if (checksum !== checkpointChecksum(rest)) return { checkpoint: parsed, rejectedBecause: 'checksum_mismatch' }
    return { checkpoint: parsed }
  } catch {
    return null
  }
}

/** Only used by tests to isolate filesystem state. */
export function checkpointDirForTests(): string {
  return CHECKPOINT_DIR
}

export function logCheckpointEvent(checkpoint: TaskCheckpoint, message: string): void {
  checkpoint.executionLogs.push(`[${new Date().toISOString()}] ${message}`)
  if (checkpoint.executionLogs.length > 200) checkpoint.executionLogs = checkpoint.executionLogs.slice(-200)
}
