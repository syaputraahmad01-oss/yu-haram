export type ProviderType = 'gemini' | 'groq' | 'openrouter' | 'ollama' | 'kimi' | 'qwen'

export interface ProviderConfig {
  id: ProviderType
  name: string
  shortName: string
  description: string
  docsUrl: string
  color: string
  letter: string
  baseUrl?: string
}

export type FileMap = Record<string, string>

export interface ParsedFile {
  path: string
  content: string
  language?: string
}

export interface AIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  files?: ParsedFile[]
  interrupted?: boolean
}

export type ModelTier = 'free' | 'free-tier' | 'paid' | 'unknown'

export interface ModelOption {
  id: string
  name: string
  provider?: ProviderType
  tier: ModelTier
  pricing?: {
    prompt?: string
    completion?: string
    request?: string
  }
  isFree?: boolean
  recommended?: string
  contextWindow?: number
  outputTokenLimit?: number
  description?: string
}

export type ProviderModelCatalog = Record<ProviderType, ModelOption[]>

export type CollaborationMode = 'economy' | 'balanced' | 'max'

export interface RoleAssignment {
  planner: string | null
  coder: string
  reviewer: string | null
}

export type RuntimeStatus = 'idle' | 'booting' | 'installing' | 'starting' | 'ready' | 'stopping' | 'error'

export interface DiagnosticItem {
  id: string
  timestamp: number
  message: string
  type: 'terminal' | 'runtime' | 'preview'
  kind?: string
  severity?: 'error' | 'warning' | 'info'
  stack?: string
  details?: string
}

export interface ProjectSnapshot {
  id: string
  timestamp: number
  createdAt?: number
  label: string
  files: FileMap
  activeFile?: string
  projectName?: string
  totalBytes?: number
}

export interface FileTreeNode {
  name: string
  path: string
  isFolder: boolean
  type?: 'file' | 'folder'
  children?: FileTreeNode[]
}

export type FileNode = FileTreeNode

// 15 Architecture Foundations Types
export type FoundationStatus = 'implemented_verified' | 'implemented_not_fully_verified' | 'partially_implemented' | 'not_implemented' | 'blocked'

export interface FoundationInfo {
  id: number
  name: string
  title: string
  category: string
  status: FoundationStatus
  summary: string
  evidence: string
}

export interface YuhaManifest {
  manifestVersion: string
  projectId: string
  name: string
  type: 'spa' | 'fullstack' | 'static' | 'library'
  version: string
  framework: string
  language: 'typescript' | 'javascript'
  entryPoint: string
  dependencies: Record<string, string>
  devDependencies?: Record<string, string>
  files: Record<string, { role: 'entry' | 'component' | 'style' | 'config' | 'util' | 'test' | 'route' | 'asset'; description?: string }>
}

export type WorkOrderStatus = 'draft' | 'queued' | 'in_progress' | 'verifying' | 'completed' | 'failed' | 'rolled_back'
export type WorkOrderType = 'generate_file' | 'repair_file' | 'edit_file' | 'continue_output' | 'update_dependency' | 'update_manifest' | 'analyze_change' | 'verify_feature' | 'rollback_change'

export interface WorkOrder {
  id: string
  type: WorkOrderType
  title: string
  objective: string
  scope: string[]
  dependencies: string[]
  priority: number
  status: WorkOrderStatus
  affectedFiles: string[]
  acceptanceCriteria: string[]
  evidence?: string[]
  retryCount?: number
  maxRetries?: number
  error?: string
}

export type VerificationStatus = 'Not Run' | 'Running' | 'Passed' | 'Failed' | 'Blocked' | 'Partially Verified'

export interface VerificationReport {
  id: string
  timestamp: number
  overallStatus: VerificationStatus
  levels: {
    contract: { status: VerificationStatus; message?: string }
    filesystem: { status: VerificationStatus; message?: string }
    typeCheck: { status: VerificationStatus; message?: string }
    build: { status: VerificationStatus; message?: string }
    tests: { status: VerificationStatus; message?: string }
    runtime: { status: VerificationStatus; message?: string }
    acceptance: { status: VerificationStatus; message?: string }
  }
}

export interface EvidenceRecord {
  id: string
  timestamp: number
  workOrderId?: string
  action: string
  actor: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  verified: boolean
  proof: string
}
