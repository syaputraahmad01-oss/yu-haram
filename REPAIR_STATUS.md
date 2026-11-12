# YUHA Repair Status — Perbaikan Fase 1-6 (2026-11-12)

Dokumen ini adalah status terkini untuk sesi perbaikan enam fase: keamanan rate limit, kebersihan repo, konsistensi dokumentasi, lint & type safety, perbaikan kecil, dan verifikasi akhir. Setiap butir memakai status: **Implemented / Unit tested / Integration tested / Production verified / NOT RUN**. Riwayat Pass 13 dipertahankan di bawah.

## Status per fase

| Fase | Perubahan | Status | Bukti |
| --- | --- | --- | --- |
| 1. Keamanan rate limit | `clientIdentity` mengabaikan SEMUA header forwarded saat hops=0 (fallback identitas koneksi langsung / bucket `local`); `isValidIpLiteral` memakai `net.isIP` (bug presedensi `&&`/`\|\|` yang meloloskan "a:b" ditutup); komentar keliru dihapus | **Implemented + Unit tested** | 4 test di `tests/phase1-security-providers.test.ts` (x-real-ip palsu hops=0, "a:b" ditolak, XFF hops=1/2 pilih entri ke-N dari kanan, IPv6 valid diterima); commit `b3a20ab`; suite 216/216 |
| 2. Kebersihan repo | `upload/`, `db/custom.db`, `db/backups/`, `.zscripts/dev.pid` berhenti dilacak (tetap di disk, masuk .gitignore); `legacy/` (Vite+Express lama, terbukti tak dirujuk mana pun) dihapus dari working tree | **Implemented** | `git ls-files \| grep -E '\.env$\|\.db$\|\.pid$\|^upload/'` → kosong; commit `2cc820b`; `legacy/` tidak ada di disk |
| 3. Dokumentasi konsisten | README: runtime aktif `src/app` (pernyataan "src/ legacy" dihapus), Bun satu-satunya package manager di semua contoh, judul "YUHA" tanpa "AI"; `YUHA_ARCHITECTURE.md` disinkronkan dengan struktur nyata | **Implemented** | commit `3930026`; `git grep "YUHA AI\|AI Builder"` → hanya 1 artefak percakapan lama di `tool-results/` (bukan permukaan nama produk, sengaja tidak diubah) |
| 4. Lint & type safety | Rule inti diaktifkan kembali sebagai error: `@typescript-eslint/no-unused-vars` (argumen `^_` diabaikan), `no-unreachable`, `no-fallthrough`, `no-redeclare`, `no-empty` (allowEmptyCatch); `react-hooks/exhaustive-deps` = warn; `noImplicitAny: false` dihapus dari tsconfig; 3 error strict + 47 unused-vars diperbaiki dengan benar (tanpa `any`/`@ts-ignore`, tanpa mematikan rule) | **Implemented + Unit tested** | commit `d4a3439`; `tsc --noEmit` 0 error; `eslint .` 0 masalah; suite 216/216 |
| 5a. parser `makeFile` | Traversal diperiksa per segmen (hanya segmen yang persis `..` ditolak) — nama sah seperti `foo..bar.ts` diterima; penolakan path absolut & backslash dipertahankan; `safePath` tetap memvalidasi ulang | **Implemented + Unit tested** | Test: `a/../b` + `src/../secret.ts` ditolak; `foo..bar.ts` diterima (`tests/ai-parser.test.ts`); commit `e182b2b` |
| 5b. `previewSandbox` | `allow-same-origin` hanya dipasang bila hostname serverUrl berakhiran `.webcontainer.io`; selain itu (termasuk URL tak parse) sandbox tanpa allow-same-origin | **Implemented + Unit tested** | Test: webcontainer.io → ada allow-same-origin; `evil.example.com`, `localhost`, suffix palsu `evil.webcontainer.io.example.com`, URL rusak → tanpa allow-same-origin (`tests/security-reliability-phase.test.ts`) |
| 5c. Komentar BudgetGovernanceManager | Header & docstring kini jujur: instance baru per HTTP request → batas hanya berlaku DALAM satu request, "estimasi per request saja", bukan pembatas biaya antar-request; pesan trip "Session token quota exceeded" → "Per-request token estimate exceeded"; `YUHA_IMPLEMENTATION_REPORT.md` diprecisionkan. Tanpa fitur baru | **Implemented + Unit tested** | Komentar route sudah jujur sejak awal ("Request-scoped estimate only…"); test Fondasi 14 diperbarui mengikuti pesan baru; suite 216/216 |
| 6a. `bun run verify` | type-check + lint + test | **PASS** | `tsc` 0 error; `eslint` 0 masalah; **216/216 test lulus, 0 gagal** |
| 6b. `bun run build` | Production build (Turbopack) | **PASS** | Compiled sukses; **19 route** (5 halaman statis: `/`, `/_not-found`, `/settings`, `/ship`, `/workspace`; 14 route API dinamis) |
| 6c. Smoke test produksi | Server standalone lokal + 3 halaman + bukti bypass tertutup | **Production verified (runtime: node)** | GET `/`, `/settings`, `/workspace` → **200**. 13 POST cepat ke `/api/chat` dengan `x-real-ip` berbeda tiap request: req 1-12 → 400 (lolos rate limit, tertolak di validasi body — memang tanpa `files`), **req 13 → 429** `{"error":"Terlalu banyak permintaan. Coba lagi dalam 60 detik."}` dengan `retry-after: 45`, `x-ratelimit-limit: 12`, `x-ratelimit-remaining: 0`; req 14 dengan IP lain → 429 lagi. Rotasi x-real-ip TIDAK menghasilkan bucket baru → **bypass tertutup** |

## Temuan tambahan (pre-existing, di luar lingkup sesi ini)

`bun .next/standalone/server.js` (script `start` di package.json) **crash saat evaluasi modul `/api/chat`**: undici 8.12.4 — terbundle lewat `src/lib/security/ssrf.ts` sejak Master PHASE 1 (`5df4310`) — memanggil `worker_threads.markAsUncloneable`, yang ada di Node 24.22.2 tetapi **tidak ada di Bun 1.3.14** (`TypeError: util.markAsUncloneable is not a function`). Halaman statis tetap 200 di bawah bun; hanya route yang menarik chunk undici yang gagal. Verifikasi produksi sesi ini dijalankan dengan `node .next/standalone/server.js` (launcher: `scripts/prod-daemon-node.py`) — runtime yang secara resmi didukung output standalone Next.js. Perbaikan opsi: jalankan start dengan node, turunkan undici, atau polyfill — keputusan diserahkan ke sesi berikutnya; sengaja tidak diubah agar sesi ini tidak keluar dari lingkup yang diminta.

## Yang tidak bisa diverifikasi di sandbox

1. **Provider cloud berkey riil** — BLOCKED (tidak ada API key asli); semua uji tetap memakai mock/dummy yang memang ditolak.
2. **Rate limit backend postgres/sqlite** — smoke test memakai backend default (memory, per-proses); backend postgres (Supabase) teruji unit, tidak diexercises live di sesi ini.
3. **Perilaku lintas-mesin** — memory backend bersifat per-proses (dokumen desain sudah menyatakan ini).

## Riwayat: Pass 13 (2026-11-12)

Snapshot sumber: commit Pass 13 di atas Pass 12 (`30877f2`). Runtime aktif: Next.js 16 App Router (`src/app`), Bun 1.3.x. Status di bawah adalah kondisi SAAT ITU; untuk temuan bun/undici terkini lihat seksi "Temuan tambahan" di atas.

| Area | Status | Bukti |
| --- | --- | --- |
| Aset internal keluar dari public | **Production verified** | 404 di dev & prod untuk `/assets/aistudio/*`; file kini di `private-assets/` (gitignored) |
| `.env` keluar dari Git | **Implemented + Production verified** | `git ls-files` tidak memuat `.env`; `.env.example` tetap tracked |
| Rate limiting | **Integration tested** | 429 live di `/api/chat` (12/menit); test race 40 paralel → tepat 5 lolos; semua route terpasang |
| SSRF + DNS rebinding | **Unit + Integration tested** | 11 test (klasifikasi IP v4/v6/mapped, literal host, allowlist, DNS nyata api.github.com); `guardedFetch` pin IP di socket; dipasang di katalog/github/deploy |
| CSP/COOP/COEP | **Browser verified** | Header terverifikasi via curl dev & prod; WebContainer tidak dipatahkan (frame-src `*.webcontainer.io`, wasm/eval untuk runtime-nya) |
| Build & test infra | **Production verified** | `ignoreBuildErrors` dihapus; tsc 0 error; ESLint bersih; 132 test lulus; clean install 1093 paket; `next build` sukses; `bun .next/standalone/server.js` 200 (halaman statis) |
| Coder fallback chain + checkpoint | **Integration tested (mock provider)** | E2E 12/12 melalui `/api/orchestrate` + checkpoint di `.data/checkpoints/`; uji dengan key provider riil = BLOCKED (tidak ada key di sandbox) |
| Model router + benchmark registry | **Unit tested** | 16 test; skor bersumber sitasi publik bertanggal; model tanpa bukti tidak diberi skor |
| Verification gate | **Integrated + Integration tested** | Event `verification` di stream E2E; 7 level jujur (yang tak dieksekusi = Not Run) |
| Debugger role | **Implemented + Unit tested (tipe/katalog)** | Override terverifikasi-gratis dipakai tanpa izin berbayar; fallback ke model aktif; anti-loop perbaikan |
| Model list & koneksi gagal (bug user) | **Browser verified** | Headless: OpenRouter 344 model tampil; error katalog kini tampil di picker; model gratis terpilih; alur persetujuan konsisten |
| 15 foundations | **Integrated (14/15 aktif caller runtime)** | Matriks lengkap di `YUHA_15_FOUNDATIONS_MAPPING.md` |
| Evaluation harness 15 benchmark | **Unit tested** | 6 test; anti-keyword-bingo terbukti; live run = BLOCKED (tanpa key) |
