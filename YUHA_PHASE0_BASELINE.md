# YUHA Master Upgrade — Baseline Audit (PHASE 0)

Tanggal: 2026-11-12. Sumber kebenaran: workspace git `7bcfc3b` (Pass 13.1).
Catatan: arsip `YU.tar` TIDAK ditemukan di `upload/`; workspace ini adalah implementasi terbaru (changelog Pass 1–13.1).

## 1. Arsitektur aktual
- Next.js 16 App Router + Turbopack, TypeScript strict (0 error), Bun 1.3.4 package manager tunggal.
- 17 route; API: `/api/chat`, `/api/orchestrate`, `/api/providers`, `/api/github/*`, `/api/deploy/*`.
- Runtime klien: WebContainer (browser), zustand persist (AES-256-GCM untuk API key), NDJSON streaming.
- Test: `bun x tsx --test tests/*.test.ts` = 140/140 pass pada baseline.

## 2. Status modul (IMPLEMENTED / INTEGRATED / TESTED / BLOCKED)

| Modul | Status | Bukti |
|---|---|---|
| SSRF guardedFetch + DNS pinning | INTEGRATED, TESTED (IPv4 dasar) | ssrf.ts; dipakai provider-catalog, github, deploy |
| Rate limiting (memory+sqlite) | INTEGRATED, TESTED | rate-limit.ts; burst test 429 |
| Error classifier + retry + backoff | INTEGRATED, TESTED | fallback-policy.ts; dipakai orchestrate |
| Circuit breaker | IMPLEMENTED, INTEGRATED — **cacat scope** | key `provider:model`, TIDAK per-kredensial → user lain bisa terblokir |
| Coder fallback berantai | INTEGRATED | orchestrate route L374-400 |
| Checkpoint | INTEGRATED — **cacat** | key = hash instruksi+provider+model; tanpa TTL/schema/integrity; save gagal → salah label timeout (L536-541) |
| Blueprint gate | IMPLEMENTED, **belum gerbang nyata** | hanya notice (L184-188), tidak menunggu persetujuan |
| Import resolver | **BUG** | `dep.replace(/^\.\//,'')` mengabaikan direktori importer (L450-457) → import valid dilabeli unresolved; evidence `verified:false` salah |
| Verification gate | INTEGRATED (statis) | hasil TIDAK memengaruhi status akhir; `done` tetap dikirim |
| Evaluation harness | IMPLEMENTED, INTEGRATED parsial | dipakai di deterministic-repair/orchestrate |
| Web Research Engine | **TIDAK ADA** | belum ada adapter pencarian |
| Free-first classification | **CACAT** | Gemini/Groq semua `unknown`; `allowPaidModels` saklar global (melanggar persetujuan per-model) |
| API key isolation | **BUG** | useAIChat L282: `getApiKey(debuggerProvider) || key` — key provider aktif bocor ke debugger provider |
| NPM command validation | IMPLEMENTED parsial | parseSafeNpmCommand ada; `.npmrc`/alias `npm:`/tarball URL belum ditolak |

## 3. Temuan yang direproduksi ulang (dari master prompt)
1. Circuit breaker lintas pengguna (3.3) — `getCircuitBreaker(provider, model)` tanpa identitas kredensial.
2. Rate limiter percaya hop pertama XFF (3.4) — `clientIdentity` ambil XFF[0] tanpa trusted proxy.
3. SSRF: NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, IPv4-compatible `::x`, Teredo `2001::/32` BELUM diblokir (3.5).
4. `debuggerKey` fallback lintas provider (bagian 4).
5. Checkpoint tanpa identitas workspace/TTL/schema/checksum; kegagalan save salah diklasifikasi timeout (5).
6. Blueprint gate hanya notifikasi (6.1).
7. Import resolver abaikan direktori importer (6.2).
8. Gemini/Groq `unknown` semua; saklar `allowPaidModels` global (3.1).
9. Verification gate tidak memengaruhi status COMPLETED (7.1).

## 4. Risiko kritis
- Kredensial satu user dapat membuka breaker untuk semua user (DoS silang).
- XFF spoof → bypass rate limit.
- IPv6 alternatif encoding → bypass SSRF menuju IP private.
- Key provider aktif terkirim ke provider lain saat auto-repair.

## 5. Rencana patch per file
- `src/lib/ai/provider-tiers.ts` (baru): kebijakan tier terpusat per provider (bukti dokumentasi free-tier Gemini/Groq).
- `src/lib/ai/catalog.ts`: modelOption pakai kebijakan tier.
- `src/lib/store/useSettingsStore.ts` + `model-cost-consent.ts`: persetujuan per model (persist).
- `src/lib/ai/fallback-policy.ts`: breaker scope `provider:model:credentialFingerprint` (HMAC).
- `src/lib/security/rate-limit.ts`: trusted-proxy hops + validasi sintaks IP + hard cap.
- `src/lib/security/ssrf.ts`: blokir NAT64/6to4/Teredo/IPv4-compatible + tes.
- `src/hooks/useAIChat.ts`: debugger wajib pakai key provider-nya; tanpa key → skip repair dengan pesan jujur.
- `src/lib/foundations/task-checkpoint.ts`: schemaVersion, workspaceId, TTL, checksum, save non-fatal.
- `src/lib/foundations/blueprint-gate.ts` + orchestrate route: blueprint menunggu persetujuan (event `blueprint` + resume dengan `blueprintApproved`).
- `src/lib/foundations/knowledge-graph.ts`: `resolveImportPath` benar (relatif ke importer, alias `@/`, ekstensi, index).
- Web Research Engine baru (`src/lib/research/*`, `/api/research`, settings UI).
- `src/app/globals.css`: tema Pure Black × Diamond.

## 6. Rencana regression test
Satu file test per fase: `tests/phase1-security-providers.test.ts`, `tests/phase2-orchestration.test.ts`, `tests/phase3-execution.test.ts`, `tests/phase4-research.test.ts`; suite penuh + type-check + build setelah tiap fase.
