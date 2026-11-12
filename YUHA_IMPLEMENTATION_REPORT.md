> **Status update — Pass 13 (2026-11-12):** Dokumen ini kini memiliki lapisan status terkini. Ringkasan Pass 13: keamanan (aset internal 404, .env untracked, rate limiting live-429, SSRF+DNS-rebinding pinned-socket, CSP diperkuat), build hardening (type checking aktif, 0 error, clean install, standalone start terverifikasi), coder fallback nyata dengan checkpoint persisten, model router berbasis benchmark tersitasi, verification gate aktif (event `verification`), debugger role diperbaiki, 15 foundations punya caller runtime aktif, evaluation harness 15 benchmark anti-keyword-bingo. Bukti lengkap: `CHANGELOG_REPAIR.md` (Pass 13) + `YUHA_TEST_REPORT.md` (132 test, E2E 12/12). Bagian di bawah adalah riwayat Pass awal — beberapa klaimnya sudah digantikan oleh Pass 13.

> **Status notice — 2026-11-11:** This document describes intended/claimed implementation, not independently verified production readiness. The supplied archive's active package scripts originally launched Express + Vite while the full orchestration and deployment API routes were under the Next.js App Router. The repair pass changes the active scripts to Next.js. Several claims below still require runtime, provider, security, and E2E evidence.

# YUHA Implementation Report
## Phase-by-Phase Technical Execution & Audit Resolution

### Executive Summary
The archive contains source modules corresponding to 15 architectural foundations and adapters for multiple AI providers. Source review shows that several modules are prototypes or are not wired into the active runtime. The 15-foundation registry has therefore been downgraded to `implemented_not_fully_verified`. The active runtime has been redirected to Next.js App Router; the archived report claims 50 passing tests, but those results have not been reproduced in this repair environment.

---

### Audit Findings & Resolutions

| # | Audited Finding | Root Cause in Legacy Code | Resolution Implemented | Test Verification |
|---|----------------|---------------------------|------------------------|-------------------|
| 1 | Netlify Deploy Boolean Bug | `validateDeploymentFiles()` returns an object `{ valid: true }`. In JS, objects are truthy, causing `if (invalid)` to always fail deployments. | Changed check to `const v = validateDeploymentFiles(files); if (!v.valid) return res.status(400)...` in `/server.ts` and `/lib/deploy/validate.ts`. | `tests/bug-fixes-audit.test.ts` (Test 1) |
| 2 | Secret & `.env` Leaks in AI Context | `buildProjectContext()` iterated over all keys in `files` without filtering `.env` or redacting keys. | Added `isSensitiveFile()` to omit `.env`, `.env.local`, `.pem`, and `id_rsa`. Added `redactSecrets()` regex scanner. | `tests/bug-fixes-audit.test.ts` (Test 2) |
| 3 | Ollama Inconsistencies | Settings migration dropped `ollama`, and missing API key broke `@ai-sdk/openai`. | Added `ollama` to `ProviderType`, preserved it in `useSettingsStore.migrate()`, and injected `ollama-local` dummy key for SDK. | `tests/bug-fixes-audit.test.ts` (Test 3) |
| 4 | Missing Kimi & Qwen Integrations | `ProviderType` only included 4 providers. | Added `kimi` (Moonshot API) and `qwen` (DashScope API) adapters, headers, catalog, and UI in `SettingsModal`. | `tests/bug-fixes-audit.test.ts` (Test 4) |
| 5 | Fallback to Paid Models Without Consent | `preferredModel()` returned `models[0]` when `allowPaid` was false and no free model existed. | Fixed `preferredModel()` to strictly return `undefined` when `allowPaid` is false. | `tests/bug-fixes-audit.test.ts` (Test 5) |
| 6 | Hardcoded Role Model IDs | Role models had hardcoded strings without dynamic selection. | Updated `useSettingsStore` to allow dynamic `setRoleModel(role, provider, model)` sourced from catalogs. | `tests/bug-fixes-audit.test.ts` (Test 6) |
| 7 | Server Rate Limiting & Origin Security | API routes had no throttling. | Legacy Express server has an in-memory limiter; active Next.js routes still need a shared rate limiter. Shared origin validation is present. | Source inspection only; no load/CSRF tests |
| 8 | Path Traversal Insecurity | `safePath` used naive regex `/\.\.[/\\]/g` susceptible to `....//` tricks. | Changed `safePath` to reject absolute, traversal, empty, control-character, and dot-only segments instead of silently rewriting attacker-controlled paths. | `tests/bug-fixes-audit.test.ts` (Test 6) |
| 9 | Insecure Package Scripts | `npm install` executed without lifecycle protections. | Initial WebContainer install and AI-proposed install/add/ci commands now apply `--ignore-scripts`; direct user terminal remains user-controlled. | Parser smoke checks only; full WebContainer E2E not run |
| 10 | Preview Sandbox Isolation | Iframe static documents lacked origin isolation guard. | Configured `sandbox="allow-scripts allow-forms allow-popups"` with CSP frame ancestor restrictions. | `components/preview/PreviewIframe.tsx` |
| 11 | Lockfile Inconsistencies | Conflicting package managers (`pnpm`, `bun`, `npm`). | Active scripts now use Next.js, but the Bun lockfile was not fully regenerated and npm lockfile was not created. | Outstanding packaging task |
| 12 | Missing Snapshot Rollback | `useHistoryStore` had snapshot creation but lacked atomic rollback action. | Implemented `restoreSnapshot(id)` restoring files, project name, and active editor tab atomically. | `tests/bug-fixes-audit.test.ts` (Test 8) |

---

### Foundation Modules Implemented
- `lib/foundations/orchestrator.ts`: State machine with bounded repair loop (`maxRepairRetries = 3`).
- `lib/foundations/repair-router.ts`: 10-category error classification engine.
- `lib/foundations/deterministic-repair.ts`: Zero-token AST and config repair gates.
- `lib/foundations/manifest-contract.ts`: `yuha.manifest.json` contract enforcement.
- `lib/foundations/model-router.ts`: Capability benchmarking & Free-First routing.
- `lib/foundations/work-order.ts`: Discrete task scheduling with topological ordering.
- `lib/foundations/verification-gate.ts`: 7-Level acceptance verification.
- `lib/foundations/incremental-change.ts`: Change impact analysis & atomic patching.
- `lib/foundations/context-governance.ts`: Token budget governance & secret redactor.
- `lib/foundations/design-system.ts`: Design token set & accessibility linter.
- `lib/foundations/knowledge-graph.ts`: Immutable evidence ledger & dependency graph.
- `lib/foundations/evaluation-harness.ts`: Continuous benchmarking harness.
- `lib/foundations/blueprint-gate.ts`: Ambiguity detector across 7 dimensions.
- `lib/foundations/budget-governance.ts`: Per-request token estimate & execution circuit breaker (one instance per HTTP request; estimates per request only — not a cross-request cost limiter or billing meter).
- `lib/foundations/sandbox-security.ts`: Path traversal, command policy & SSRF guards.


## Repair Pass 5 additions

- API keys are held in session memory only; no ciphertext or encryption key is persisted to localStorage. Legacy values are discarded.
- AI project context filters common credential directories/files and invalid/absolute paths before constructing prompts.
- WebContainer file write/mount/delete operations reject invalid paths.
- Chat, orchestration, and provider-catalog endpoints now use the bounded streaming JSON reader.
- Network egress helper checks expanded to local/private/metadata destinations, but not enforced by a universal network proxy.


## Repair Pass 5 — model routing and foundation evidence

- Removed hardcoded model identifiers and unmeasured capability scores from the capability router. It now requires caller-supplied model candidates and evidence; no active Next.js route currently supplies benchmark-backed candidates.
- New installations no longer assume a default Gemini model ID. The user must select a model from the current provider catalog.
- Removed provider-card wording that implied Gemini Flash is automatically free. Model cost remains unknown unless the provider catalog gives explicit evidence; account-level quotas and eligibility remain provider-controlled.
- Updated the 15-foundation registry based on active call-site search: only Foundation 14 has direct active API-route integration; Foundation 9's underlying context helper is used, but its wrapper is not. Other modules are prototypes/standalone until wired into active runtime.

## Repair Pass 6 additions (2026-11-11)

- `/api/chat` and `/api/orchestrate` now share `validateWorkspaceFileMap()` before passing workspace files into model workflows. The validator enforces map shape, 500-file cap, safe relative paths, string-only contents, 1 MB per-file cap, and 15 MB aggregate cap (the request-body limit remains independently stricter at 1 MB on these routes).
- Project context now rejects paths failing the canonical `isPathSafe()` policy and redacts additional OpenRouter/OpenAI project, Slack, npm, and Google OAuth token patterns.
- These changes have focused isolated runtime evidence only. They do not establish complete secret detection, full API integration, or production readiness.
