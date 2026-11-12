> **Mapping update — Pass 13 (2026-11-12):** Semua 15 foundations kini memiliki **caller runtime aktif** di jalur `/api/orchestrate` (atau klien). Matriks status terkini:
>
> | # | Foundation | Caller runtime aktif (Pass 13) | Status |
> | --- | --- | --- | --- |
> | 1 | AI Orchestrator | `YuhaOrchestrator` session + events di `/api/orchestrate` | implemented_integration_tested |
> | 2 | Error-Aware Repair Router | `classifyError()` pada notice kegagalan planner/reviewer/coder | implemented_integration_tested |
> | 3 | Deterministic Repair Gate | `stripAccidentalFences` + `fixUnbalancedBraces` pada file hasil coder | implemented_unit_tested |
> | 4 | Manifest Contract | `syncWorkspaceToManifest` + `validateContract` sebelum verifikasi | implemented_integration_tested |
> | 5 | Capability Model Router | urutan fallback coder via `selectBestModelForTask('coding')` + benchmark registry bersitasi | implemented_unit_tested |
> | 6 | Work Order | `WorkOrderManager` per tugas orchestration (status + evidence + retry) | implemented_integration_tested |
> | 7 | Verification Gate | `verifyWorkspace()` di orchestrate + event `verification` + toast klien; build auto-repair klien masuk pipeline | implemented_integration_tested |
> | 8 | Incremental Change | `analyzeChangeImpact` (sasaran file + risiko) di orchestrate | implemented_unit_tested |
> | 9 | Context Governance | `ContextPackGovernance.buildContextPack` (redaksi rahasia + audit + bound) | implemented_integration_tested |
> | 10 | Design System | `DesignSystemValidator.auditUIQuality` pada file UI hasil | implemented_unit_tested |
> | 11 | Knowledge Graph | `buildGraphFromFiles` + deteksi import lokal tak terjawab + evidence ledger | implemented_unit_tested |
> | 12 | Evaluation Harness | 15 benchmark eksekusiabel; live model run BLOCKED (tanpa key) | implemented_unit_tested / live BLOCKED |
> | 13 | Blueprint Gate | `BlueprintAmbiguityGate.analyzePrompt` di orchestrate | implemented_integration_tested |
> | 14 | Budget Governance | `BudgetGovernanceManager` di `/api/chat` + `/api/orchestrate` (sudah sejak Pass sebelumnya) | implemented_integration_tested |
> | 15 | Sandbox Security | `SandboxSecurityLayer.validatePath` pada path hasil model; jembatan ke `security/ssrf.ts` + gerbang perintah | implemented_integration_tested |
>
> Catatan jujur: "integration tested" di sini = terpanggil pada jalur HTTP nyata yang diuji E2E dengan mock provider (`scripts/e2e-chat-pipeline.ts`, 12/12). Uji dengan key provider cloud riil tetap BLOCKED karena tidak ada kredensial di sandbox. State yang harus lintas sesi (checkpoint tugas) persisten di `.data/checkpoints/` (filesystem, atomic write).

> **Verification correction — 2026-11-11:** Module and test-file existence are not proof of active runtime integration. A call-site search of the active Next.js app found direct request-path integration only for Foundation 14. Foundation 9 uses the underlying `buildProjectContext()` helper in active routes, but its `ContextPackGovernance` wrapper is not called. Foundation 15 is not enforced as a universal network sandbox; WebContainer uses a separate `safePath()` helper. Foundations without active call sites are marked `partially_implemented`; Foundation 14 remains `implemented_not_fully_verified` because its request-scoped estimate guard has not passed the full suite or live tests.

# YUHA 15 Foundations Mapping Matrix
## Blueprint Reconciliation & Evidence References (Not Runtime Verification)

| ID | Foundation Name | Implementation Module | Architectural Role | Verification Status | Evidence Reference (not execution proof) |
|----|-----------------|----------------------|--------------------|---------------------|-------------------|
| **1** | **AI Orchestrator & Repair Loop** | `lib/foundations/orchestrator.ts` | Standalone state machine; active `/api/orchestrate` uses a separate route-level workflow and does not call this module. | **Partially implemented** | Module + unit test only; no active route import found |
| **2** | **Error-Aware Repair Router** | `lib/foundations/repair-router.ts` | Standalone classifier; no active Next.js route/UI caller found. | **Partially implemented** | Module + unit test only |
| **3** | **Deterministic Repair Gate** | `lib/foundations/deterministic-repair.ts` | Standalone helper; no active route/UI caller found. | **Partially implemented** | Module + unit test only |
| **4** | **Manifest-Driven File Contract** | `lib/foundations/manifest-contract.ts` | Standalone contract validator; no active route/UI caller found. | **Partially implemented** | Module + unit test only |
| **5** | **Capability-Based Model Router** | `lib/foundations/model-router.ts` | Accepts caller-supplied candidate evidence; contains no hardcoded model IDs/scores. No live-catalog/benchmark caller is wired. | **Partially implemented** | Module + synthetic-fixture unit test; no active caller |
| **6** | **Work Order Protocol** | `lib/foundations/work-order.ts` | Standalone dependency scheduler; no active route/UI caller found. | **Partially implemented** | Module + unit test only |
| **7** | **Acceptance-Driven Verification Gate** | `lib/foundations/verification-gate.ts` | Gate module exists, but no active caller was found; its own statuses do not substitute for executed commands. | **Partially implemented** | Module + unit test only |
| **8** | **Incremental Change Protocol** | `lib/foundations/incremental-change.ts` | Standalone patch helper; no active route/UI caller found. | **Partially implemented** | Module + unit test only |
| **9** | **Context Pack Governance** | `lib/foundations/context-governance.ts` | Wrapper is not called. Active `/api/chat` and `/api/orchestrate` call `buildProjectContext()` directly, which now excludes common credential files and unsafe paths. | **Partially implemented** | Active helper call sites + wrapper/unit tests |
| **10** | **Design System & Component Registry** | `lib/foundations/design-system.ts` | Standalone registry/linter; no active runtime caller found; accessibility claims not independently verified. | **Partially implemented** | Module + unit test only |
| **11** | **Project Knowledge Graph & Evidence Ledger** | `lib/foundations/knowledge-graph.ts` | In-memory prototype; no active runtime caller or durable cross-session storage found. | **Partially implemented** | Module + unit test only |
| **12** | **Continuous Evaluation Harness** | `lib/foundations/evaluation-harness.ts` | Prototype only; no active scheduled benchmark run or measured model evaluation found. | **Partially implemented** | Module + unit test only |
| **13** | **Blueprint Proposal & Ambiguity Gate** | `lib/foundations/blueprint-gate.ts` | Standalone scope-analysis helper; no active runtime caller found. | **Partially implemented** | Module + unit test only |
| **14** | **Budget Governance & Circuit Breaker** | `lib/foundations/budget-governance.ts` | Integrated into `/api/chat` and `/api/orchestrate` as request-scoped character-based token estimates; not billing or account-wide quota enforcement. | **Implemented; not fully verified** | Active route imports + focused isolated tests; full tests/build/live provider tests blocked |
| **15** | **Sandboxed Execution & Security Isolation** | `lib/foundations/sandbox-security.ts` | Policy helper is not wired as universal egress control. Active WebContainer file paths use `safePath()` separately; SSRF isolation is not proven. | **Partially implemented** | Module + tests; helper call-site gap documented |
