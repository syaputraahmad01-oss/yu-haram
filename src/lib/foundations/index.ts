/**
 * YUHA ARCHITECTURE FOUNDATIONS INDEX & REGISTRY
 * Central status and metadata provider for all 15 Blueprint Foundations.
 */

import type { FoundationInfo } from '@/types'

export * from './orchestrator'
export * from './repair-router'
export * from './deterministic-repair'
export * from './manifest-contract'
export * from './model-router'
export * from './work-order'
export * from './verification-gate'
export * from './incremental-change'
export * from './context-governance'
export * from './design-system'
export * from './knowledge-graph'
export * from './evaluation-harness'
export * from './blueprint-gate'
export * from './budget-governance'
export * from './sandbox-security'

export const YUHA_15_FOUNDATIONS_STATUS: FoundationInfo[] = [
  {
    id: 1,
    name: 'AI Orchestrator & Repair Loop',
    title: 'Fondasi 1 — AI Orchestrator & Repair Loop',
    category: 'Core Orchestration',
    status: 'partially_implemented',
    summary: 'Standalone orchestration state machine. The active Next.js /api/orchestrate route uses a separate route-level workflow and does not call this module.',
    evidence: 'lib/foundations/orchestrator.ts, tests/foundations.test.ts',
  },
  {
    id: 2,
    name: 'Error-Aware Repair Router',
    title: 'Fondasi 2 — Error-Aware Repair Router',
    category: 'Diagnostic & Routing',
    status: 'partially_implemented',
    summary: 'Standalone error classifier; no active Next.js route or UI call site was found during this pass.',
    evidence: 'lib/foundations/repair-router.ts, tests/foundations.test.ts',
  },
  {
    id: 3,
    name: 'Deterministic Repair Gate',
    title: 'Fondasi 3 — Deterministic Repair Gate',
    category: 'Automated Repair',
    status: 'partially_implemented',
    summary: 'Standalone deterministic repair helper; no active runtime call site was found during this pass.',
    evidence: 'lib/foundations/deterministic-repair.ts, tests/foundations.test.ts',
  },
  {
    id: 4,
    name: 'Manifest-Driven File Contract',
    title: 'Fondasi 4 — Manifest-Driven File Contract',
    category: 'Project Integrity',
    status: 'partially_implemented',
    summary: 'Standalone manifest validator; no active runtime call site was found during this pass.',
    evidence: 'lib/foundations/manifest-contract.ts, tests/foundations.test.ts',
  },
  {
    id: 5,
    name: 'Capability-Based Model Router',
    title: 'Fondasi 5 — Capability-Based Model Router',
    category: 'AI Model Management',
    status: 'partially_implemented',
    summary: 'Caller-supplied capability router with no built-in model IDs or scores. It is not wired to live catalogs or benchmark evidence in the active runtime.',
    evidence: 'lib/foundations/model-router.ts, tests/foundations.test.ts (synthetic candidate fixtures)',
  },
  {
    id: 6,
    name: 'Work Order Protocol',
    title: 'Fondasi 6 — Work Order Protocol',
    category: 'Task Execution',
    status: 'partially_implemented',
    summary: 'Standalone work-order scheduler; no active runtime call site was found during this pass.',
    evidence: 'lib/foundations/work-order.ts, tests/foundations.test.ts',
  },
  {
    id: 7,
    name: 'Acceptance-Driven Verification Gate',
    title: 'Fondasi 7 — Acceptance-Driven Verification Gate',
    category: 'Quality Assurance',
    status: 'partially_implemented',
    summary: 'Verification-gate module exists, but no active runtime caller was found. Build/test/runtime evidence must come from actual executed checks.',
    evidence: 'lib/foundations/verification-gate.ts, tests/foundations.test.ts',
  },
  {
    id: 8,
    name: 'Incremental Change Protocol',
    title: 'Fondasi 8 — Incremental Change Protocol',
    category: 'Workspace Evolution',
    status: 'partially_implemented',
    summary: 'Standalone incremental-change helper; no active runtime call site was found during this pass.',
    evidence: 'lib/foundations/incremental-change.ts, tests/foundations.test.ts',
  },
  {
    id: 9,
    name: 'Context Pack Governance',
    title: 'Fondasi 9 — Context Pack Governance',
    category: 'Context & Security',
    status: 'partially_implemented',
    summary: 'ContextPackGovernance wrapper has no active caller. The active chat/orchestrate routes call buildProjectContext directly; that helper now filters common credential files and paths.',
    evidence: 'lib/foundations/context-governance.ts, lib/ai/orchestration.ts, tests/security-reliability-phase.test.ts',
  },
  {
    id: 10,
    name: 'Design System & Component Registry',
    title: 'Fondasi 10 — Design System & Component Registry',
    category: 'Frontend Engineering',
    status: 'partially_implemented',
    summary: 'Standalone design-system registry/linter; no active runtime caller was found. Component verification claims are not independently evidenced.',
    evidence: 'lib/foundations/design-system.ts, tests/foundations.test.ts',
  },
  {
    id: 11,
    name: 'Project Knowledge Graph & Evidence Ledger',
    title: 'Fondasi 11 — Project Knowledge Graph & Evidence Ledger',
    category: 'Stateful Memory',
    status: 'partially_implemented',
    summary: 'In-memory knowledge graph/evidence module; no active runtime caller or cross-session persistence was found.',
    evidence: 'lib/foundations/knowledge-graph.ts, tests/foundations.test.ts',
  },
  {
    id: 12,
    name: 'Continuous Evaluation Harness',
    title: 'Fondasi 12 — Continuous Evaluation Harness',
    category: 'Benchmarking',
    status: 'partially_implemented',
    summary: 'Evaluation harness prototype; no scheduled or active benchmark execution was found, and no measured model scores are claimed.',
    evidence: 'lib/foundations/evaluation-harness.ts, tests/foundations.test.ts',
  },
  {
    id: 13,
    name: 'Blueprint Proposal & Ambiguity Gate',
    title: 'Fondasi 13 — Blueprint Proposal & Ambiguity Gate',
    category: 'Requirements & Scoping',
    status: 'partially_implemented',
    summary: 'Standalone ambiguity gate; no active runtime caller was found in the Next.js application.',
    evidence: 'lib/foundations/blueprint-gate.ts, tests/foundations.test.ts',
  },
  {
    id: 14,
    name: 'Free-Tier Budget Governance & Circuit Breaker',
    title: 'Fondasi 14 — Free-Tier Budget Governance & Circuit Breaker',
    category: 'Resource Protection',
    status: 'implemented_not_fully_verified',
    summary: 'Active request-scoped estimated-token guard in /api/chat and /api/orchestrate. It is not a provider billing meter or cross-request quota service.',
    evidence: 'lib/foundations/budget-governance.ts, tests/foundations.test.ts',
  },
  {
    id: 15,
    name: 'Sandboxed Execution & Security Isolation Layer',
    title: 'Fondasi 15 — Sandboxed Execution & Security Isolation Layer',
    category: 'Security & Isolation',
    status: 'partially_implemented',
    summary: 'Policy helper only. Active WebContainer paths use safePath separately; no universal network egress proxy enforces this class, so SSRF isolation is not established.',
    evidence: 'lib/foundations/sandbox-security.ts, tests/foundations.test.ts',
  },
]
