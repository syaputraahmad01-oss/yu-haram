# YUHA Test Report — Pass 13 (2026-11-12)

## Environment

- Bun 1.3.x (package manager utama), Next.js 16 App Router + Turbopack (dev), Node 24 (tsx test runner)
- Dev server: port 3000; production standalone: `bun .next/standalone/server.js` (diverifikasi di port 3101)
- Mock provider OpenAI-compatible: `scripts/mock-provider.mjs` di 127.0.0.1:11434 (port Ollama)

## Ringkasan hasil

| Gerbang | Hasil | Bukti |
| --- | --- | --- |
| `bun run type-check` (tsc --noEmit) | **0 error** | dijalankan setelah clean install |
| `bun run lint` (eslint .) | **0 error, 0 warning** | — |
| `bun run test` | **132 lulus / 0 gagal** | 15 file test; rincian di bawah |
| `bun run build` (dengan type checking aktif) | **sukses, 17 route** | `ignoreBuildErrors` sudah dihapus |
| Clean install | **sukses** | `rm -rf node_modules && bun install` → 1093 paket, 5,77 s |
| Start standalone | **GET / 200 + CSP aktif** | `bun .next/standalone/server.js` |
| E2E pipeline HTTP | **12/12 lulus** | `scripts/e2e-chat-pipeline.ts` |

## Rincian test suite (132)

- `tests/pass13-security.test.ts` — 11: rate limit (termasuk race 40 paralel), klasifikasi IP v4/v6/IPv4-mapped, blokir loopback/metadata, allowlist host
- `tests/pass13-coder-fallback.test.ts` — 16: classifier 17 jenis, retry/backoff/Retry-After, circuit breaker (open/half-open/permanen), checkpoint key/manifest, benchmark registry bersitasi
- `tests/pass13-evaluation-harness.test.ts` — 6: 15 tugas valid & eksekusiabel, output referensi lulus, keyword-stuffing gagal, pola terlarang memotong skor, deterministik
- `tests/chat-stream-protocol.test.ts` — 10: NDJSON/SSE, error event, orchestration headers
- `tests/foundations.test.ts` — 17: kontrak 15 foundations + verification gate
- Sisanya (regresi pass sebelumnya): 72 — katalog free-first, parser, store, proxy origin, dsb.

## E2E (live dev server + mock provider)

1. `/api/chat` ollama+mock → 200, NDJSON, teks mock utuh, delta ≥2, `done` ✓
2. Error provider tersurfacing melalui stream (bukan ditelan) ✓
3. `/api/orchestrate` dengan header `x-yuha-key-ollama` → 200, delta + `agent-plan` + `verification` + `done` ✓
4. Keyless local (ollama) diizinkan (200); cloud tanpa key tetap 401 ✓

## Keamanan (live)

- Burst 14 POST `/api/chat` → 12×401 lalu 2×429 + header `Retry-After` (limit 12/menit) ✓
- `/assets/aistudio/*` → 404 (dev & prod) ✓
- `.env` tidak ada di `git ls-files` ✓

## Browser verified (headless, agent-browser)

- `/settings`: simpan key → masked + "Tersimpan terenkripsi"; reload → key rehydrate dari `apiKeysEnc` (AES-256-GCM, device key IndexedDB); katalog OpenRouter 344 model ✓
- Key invalid → pesan "Katalog gagal diperbarui: … API key rejected" tampil ✓
- Composer picker `/workspace`: grup model tampil; error katalog provider kini tampil (tadinya senyap); model gratis terpilih → trigger menampilkan nama model ✓

## Yang TIDAK diuji (jujur)

- Provider cloud dengan API key riil (tidak ada key di sandbox) — semua uji provider memakai mock; key dummy memang harus ditolak (401/403 terverifikasi dari endpoint asli Google/Groq/Moonshot/DashScope).
- Benchmark harness terhadap model live (status `executedLive=false`, `buildResult='not_run'`).
- Siklus penuh WebContainer (npm install di dalam container) di browser headless.
- Deploy end-to-end ke platform eksternal dengan token riil.
