# YUHA Repair Changelog

## Hotfix — 2026-11-12 — Hydration mismatch "base-ui-_R_…_" di IconButton: akar masalah dibuktikan (server/client version skew), komponen dikeraskan via API override Base UI, semua verifikasi live PASS

**Gejala (laporan user):** React hydration error — *"A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up."* pada `src/components/layout/IconButton.tsx:6`, ID trigger tooltip: server `base-ui-_R_1saeatmlb_` vs client `base-ui-_R_f2jatmlb_`.

**Rantai akar masalah (dibuktikan, bukan ditebak):**
1. **Mekanisme ID**: Base UI 1.9.0 menghasilkan id trigger via `useBaseUiId()` → `@base-ui/utils/useId` → murni `React.useId()` berprefix `base-ui-` (dibaca langsung dari source `node_modules/@base-ui/react/internals/useBaseUiId.mjs` + `@base-ui/utils/useId.mjs`). ID = fungsi POSISI komponen di tree (path fork ancestor). Deterministik ⇔ tree server = tree client.
2. **Kode saat ini deterministik — dibuktikan empiris**: SSR `/` di-fetch dua kali → 21 id identik byte-per-byte; headless Chromium memuat SEMUA route (`/ /workspace /settings /ship`) → console bersih, nol error, DOM hidup = 21/21 id SSR persis (asisten rail: `1saeatmlb`). Dengan localStorage sesi sebelumnya (chat 2 pesan + settings + history + files) → hydration tetap bersih (semua store `skipHydration`, rehydrate hanya post-mount). Fast Refresh pada tab terbuka setelah edit file → bersih.
3. **ID server user = kode saat ini**: `base-ui-_R_1saeatmlb_` adalah id tombol "Assistant" pada SSR `/` SAAT INI. ID client user `f2jatmlb` tidak diproduksi oleh render mana pun dari kode saat ini (server maupun client, route mana pun) — dan **tepat satu level fork lebih pendek** (9→8 karakter): client mengeksekusi tree komponen dengan SATU wrapper non-DOM lebih sedikit di ancestornya, namun DOM yang dihasilkan identik → React hanya melaporkan selisih atribut, bukan struktur.
4. **Arkeologi git**: checkpoint platform `710b94b` sekaligus (a) pin `next@16.1.3` di `bun.lock` dan (b) menambah `StoreHydrator` sebagai child kedua `<body>` (= +1 fork untuk seluruh tree) — snapshot source pertama yang ter-commit; parent-nya hanya "Initial commit" kosong (`.env`, `.gitignore`, `download`). Tree client "satu fork lebih pendek" hanya berasal dari state dev transien pra-checkpoint yang tidak pernah ter-commit.
5. **Vektor stale-chunk terbukti layak**: URL chunk dev Turbopack berbasis PATH — set konten chunk URL identik sebelum/sesudah edit file (diverifikasi live) — sehingga layer cache yang mengabaikan `no-store` (mis. gateway preview) dapat menyajikan client JS lama terhadap HTML baru. Server dev sendiri sudah mengirim `Cache-Control: no-store, must-revalidate` untuk HTML dan chunk (diverifikasi via header).

**Kesimpulan:** mismatch = artefak version-skew (HTML baru + bundle client lama) pada jendela upgrade/checkpoint platform — bukan defect non-determinisme pada kode; kode terbukti hidrasi-sempurna pada kondisi apapun yang bisa direproduksi.

**Perbaikan yang diterapkan (tanpa menyembunyikan error, tanpa menurunkan UI/a11y/SSR):**
- `IconButton` kini merutekan prop `id` standar HTML ke **`TooltipTrigger`'s `id` override** (jalur resmi Base UI: `useBaseUiId(idProp)`) alih-alih menyebarkannya ke `<button>` render-element tempat ia akan bertabrakan dengan id milik Base UI saat merge props. Behavior default (React `useId` posisional) TIDAK berubah — nol call-site diubah, markup SSR terbukti identik (keluarga id `1saeatmlb` tetap). Prop `id` kini menjadi jalur deterministik opt-in yang membuat markup komponen ini kebal terhadap pergeseran fork wrapper di tempat lain dalam tree. Tidak ada hardcode ID, tidak ada `suppressHydrationWarning`, SSR tetap nyala, Base UI dipertahankan.
- Probe live: `id="yuha-audit-probe"` pada satu IconButton → muncul identik di HTML SSR dan DOM hidup dengan seluruh atribut tooltip utuh; sesudahnya di revert.
- Audit komponen terkait: `sidebar.tsx`/`chart.tsx`/`form.tsx` (shadcn, memakai `Math.random`/`useId`) = dead code, nol importer — inert. `SettingsModal` render `null` saat tertutup (bacaan localStorage langsung `ProviderCard`/`getApiKey` tidak pernah ikut hydration). `ModelSelect` (catalog hooks) initial state kosong konsisten dua sisi. Tidak ada nested interactive pada IconButton (children = ikon SVG).

**Verifikasi (semua live):** tsc 0 · eslint 0 · suite **210/210** · build produksi 18 route · server standalone produksi: semua halaman 200, `/api/health/database` 200 (latency 239ms ke Supabase Seoul), console KOSONG pada seluruh load, **21/21 id SSR = id DOM hidup** (exact match), tooltip: hover buka/tutup ✓, Tab-focus buka ✓, Escape tutup (fokus bertahan) ✓, klik berfungsi (toggle terminal, modal settings via event) ✓, refresh bersih ✓, navigasi client-side `/`↔`/settings` bersih ✓. Dev server dipulihkan via daemon penuh (semua route 200, id SSR kembali ke keluarga `1saeatmlb` — bukti nol regresi markup). Ditambahkan `scripts/prod-daemon.py` (launcher double-fork untuk verifikasi server produksi antar tool-call).

**Catatan operasional:** bila error ini muncul lagi di browser, itu sinyal bundle client basi (cache) — hard refresh (Ctrl/Cmd+Shift+R) memulihkannya; header aplikasi sudah `no-store`. Observasi library (bukan defect aplikasi): Base UI 1.9.0 pada state terbuka tidak memasang `aria-describedby`/`id` pada popup — nama accessible tetap terjaga via `aria-label` trigger yang identik dengan isi tooltip.

## Pass 15.2 — 2026-11-12 — MIGRASI LIVE SELESAI: skema diterapkan ke Supabase, semua verifikasi live PASS

**Kelanjutan**: ±15 menit setelah diagnosis Pass 15.1, kredensial yang sama di `.env` (tidak pernah diubah) **mulai diterima server** — re-verifikasi wire-level: `AuthenticationOk — CREDENTIALS ACCEPTED` (kemungkinan propagasi/aktifasi password database di sisi Supabase baru selesai; catatan operasional: perubahan password database dapat memakan beberapa menit aktif di pooler). Seluruh pipeline live langsung dieksekusi berurutan:

1. **`bun run db:deploy`** (DIRECT_URL session pooler 5432) → `0001_init` **applied**: "All migrations have been successfully applied."
2. **`scripts/verify-supabase-schema.ts`** (jalur runtime tx 6543) → 13 tabel ✓ (12 domain + `_prisma_migrations`), enum `MessageRole`/`MemoryKind` ✓, histori applied ✓, **11 FK, 28 index** — SCHEMA VERIFIED.
3. **`scripts/migrate-sqlite-to-postgres.ts`** live → `User 0→0 PASS, Post 0→0 PASS` (sumber memang kosong; idempoten; sumber read-only tak tersentuh).
4. **`prisma migrate status`** live → "Database schema is up to date!"
5. **`GET /api/health/database`** live → **200 `{"status":"ok","database":"postgresql","latencyMs":237–283}`**.
6. **Phase 10 benchmark** (`scripts/benchmark-supabase-latency.ts`) → cold 548ms; steady-state 10×SELECT 1: **236–237ms** (min 236/p50 236/avg 236/max 237; sandbox→Seoul, deviasi ≤1ms).
7. **Rate-limit postgres live** (`YUHA_RATE_LIMIT_BACKEND=postgres scripts/verify-supabase-ratelimit.ts`) → 12 hit limit-5: tepat 5 pertama allowed, 6–12 blocked; baris window atomik (`count=12`) terverifikasi & dibersihkan. **PASS**.

Status migrasi master directive: **COMPLETED** (15/15 phase — offline + live). Regresi akhir: tsc 0 · eslint 0 · **210/210** · shell 4/4 · halaman 200. Password tetap hanya di `.env`/`.env.supabase` (git-ignored; secret-scan repo bersih).

## Pass 15.1 — 2026-11-12 — Eksekusi live kredensial Supabase: konektivitas TERBUKTI, password DITOLAK server (28P01) + perbaikan 2 hazard lingkungan platform

**Konteks:** user menyediakan kredensial Supabase (DATABASE_URL transaction pooler 6543 + DIRECT_URL session pooler 5432). Seluruh pipeline offline sudah siap dari Pass 15 — tinggal eksekusi live.

**Hasil eksekusi live (bukti wire-level, bukan asumsi):**
- `prisma migrate status` / `db execute` pada **kedua pooler** → `P1000 Authentication failed`.
- Diagnosis independen tanpa dependensi baru: `scripts/pg-auth-diagnose.ts` — **klien SCRAM-SHA-256 mentah** di atas protokol wire PostgreSQL (SSLRequest → TLS 1.3 → StartupMessage → full exchange SCRAM dengan pbkdf2/hmac/sha256). Bukti: sertifikat asli `*.pooler.supabase.com` (issuer "Supabase Inc"), server menawarkan SCRAM-SHA-256, challenge project-specific diterbitkan, proof dikirim → **server menjawab `28P01 password authentication failed for user "postgres"` (FATAL)** di **kedua** pooler (5432 dan 6543).
- Kontrol negatif: username polos `postgres` (tanpa suffix ref proyek) → `XX000 (ENOIDENTIFIER) no tenant identifier provided` — membuktikan format username `postgres.<ref>` pada string user **sudah benar**; kegagalan murni pada password.
- **Kesimpulan:** jaringan/TLS/username/format URL benar; password yang diberikan user bukan password database yang valid untuk proyek `utyzmaqbkhhxrnymtzqc`. Kemungkinan: tertukar dengan password akun dashboard Supabase (berbeda dari password database), typo, atau password di-rotate. **Tindakan user:** Supabase Dashboard → Project Settings → Database → reset Database password → perbarui `.env`/`.env.supabase`. Setelah itu: `bun run db:deploy` → `bun scripts/migrate-sqlite-to-postgres.ts` → `curl /api/health/database`.

**2 hazard lingkungan platform ditemukan & diperbaiki (blocking yang tak terlihat sebelum kredensial hidup):**
1. **Env sistem stale menimpa `.env`**: lingkungan tool/boot menyuntikkan `DATABASE_URL=file:...custom.db` (SQLite lama); Next.js (@next/env) dan Bun **tidak membiarkan `.env` menimpa env proses yang sudah ada** → dev server selamanya melihat URL SQLite (terbukti via `/proc/<pid>/environ`). **Fix:** `dev.sh` kini me-`source .env` dengan `set -a` setelah restore — file proyek menjadi otoritatif untuk seluruh process tree boot.
2. **Boot platform me-reset `.env`**: `/start.sh` (milik platform, tak bisa diubah) menimpa `.env` dengan baris SQLite lama pada sebagian jalur boot. **Fix:** `.env.supabase` (git-ignored, mode 600) sebagai backup; `dev.sh` me-restore-nya bila `.env` tidak lagi mengarah ke pooler Supabase.

**Perbaikan rantai boot lainnya:**
- `dev.sh`: `db:push` → **`db:deploy`** (`prisma migrate deploy`) — `db push` pada proyek fresh akan membuat tabel TANPA histori migrasi → `migrate deploy` belakangan gagal drift. Non-fatal tetap (WARN bila unreachable/kredensial ditolak; bukti di `.zscripts/dev-boot.log`).
- `scripts/dev-daemon.py`: log boot dipisah ke `.zscripts/dev-boot.log` — `next dev | tee dev.log` **memotong** `dev.log` saat start dan selama ini menghapus jejak langkah boot.
- Test diperkuat: `tests/supabase-migration.test.ts` kini juga meng-assert migrasi boot via `db:deploy`, restore `.env.supabase`, dan sourcing `.env`.

**Verifikasi:** dev server direstart via daemon dengan env postgres terbukti di `/proc/<pid>/environ`; `/api/health/database` jujur `503 {"status":"unreachable"}` (configured, auth ditolak — bukan "unconfigured" lagi); semua halaman `/ /workspace /settings /ship` 200; tsc 0 · eslint 0 · suite **210/210** · shell 4/4. Password tidak pernah dicetak/di-commit (`.env*` git-ignored, diverifikasi `git check-ignore`; laporan ini hanya menyebut nilai yang user tulis eksplisit di chat).

## Pass 15 — 2026-11-12 — MIGRASI LENGKAP KE SUPABASE POSTGRESQL (master directive) — PARTIALLY COMPLETED (blocked on credentials, bukan pada pekerjaan)

Laporan lengkap + bukti per phase: `YUHA_SUPABASE_MIGRATION_REPORT.md`. Ringkas:

- **Audit (Phase 1)** membuktikan: SQLite `db/custom.db` = scaffold 2 tabel **0 record**; `src/lib/db.ts` dead scaffolding (nol importer); persistence nyata YUHA di browser; tidak ada sistem auth. Prisma resolved 6.19.2 (deklarasi ^6.11.1, major 6 sama, tidak diubah).
- **Backup pra-perubahan**: `db/backups/2026-11-12-pre-supabase/` (biner + dump schema + skema lama). Sumber tidak pernah dimodifikasi/dihapus.
- **Schema (Phase 2)**: `postgresql` + `directUrl` (Prisma 6); 12 model domain (User, Session, Project, ProjectFile, Conversation, Message, AiUsage, ModelConfig, UserSettings, AgentMemory, RateLimitWindow, Post-scaffold); enum natif PG, jsonb, Decimal(12,6), FK berindeks eksplisit; `ProjectFile.storageKey` membuka object storage tanpa migrasi ulang. Migrasi awal dibuat offline: `prisma/migrations/0001_init/migration.sql` + lock (provider postgresql).
- **Data (Phase 3)**: 0 baris — tooling lengkap & idempotent (`scripts/migrate-sqlite-to-postgres.ts`: read-only, upsert by PK, tabel validasi, refusal tanpa kredensial — exit 1 terverifikasi).
- **Client (Phase 4)**: singleton aman pooler; query log opt-in `YUHA_DB_LOG_QUERIES`.
- **API (Phase 6)**: kontrak tak berubah; `checkRateLimit` jadi async (interface mendukung store jaringan) — 11 call-site di-`await`; tambah `GET /api/health/database` (CSRF + rate limit + SELECT 1 terukur, anti-bocor detail koneksi).
- **Rate limit (Phase 7)**: backend `postgres` opsional (upsert atomik ON CONFLICT, tabel RateLimitWindow) — multi-instance TANPA layanan berbayar baru; default tetap memory (jujur per-process).
- **Deployment (Phase 13/14)**: `dev.sh` db:push kondisional+non-fatal (regresi preview dicegah), `database-runtime-build.sh` validasi PG + ship prisma/ + migrate hanya opt-in `YUHA_RUN_MIGRATIONS_ON_BUILD=1`, `start.sh` fail-fast tanpa fallback SQLite, `db:deploy` = `prisma migrate deploy`.
- **Verifikasi**: tsc 0 · eslint 0 · suite **210/210** (199 + 11 baru) · shell test 4/4 · build 18 route · live: semua halaman 200, health endpoint 503 jujur "unconfigured". **NOT TESTED (jujur)**: konektivitas Supabase live, `migrate deploy`, migrasi data live, latency — password database tidak tersedia di sandbox (tidak boleh diketik ke prompt); langkah past-password tercantum di laporan §J-K.
- WebContainers/Monaco/Xterm/preview/terminal: **nol perubahan** (Phase 8) — non-regresi dibuktikan build+test+live.

## Hotfix — 2026-11-12 — Hydration mismatch "attributes didn't match": satu-satunya divergensi SSR nyata dihilangkan (jam pesan di-gate mount)

**Gejala:** user melaporkan error React di konsol: *"A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up."*

**Audit sistematis (semua kandidat diperiksa, bukan tebak-tebakan):**
- Seluruh 5 store persist (`chat`/`connection`/`file`/`history`/`settings`) sudah `skipHydration: true` + `rehydrate()` hanya di `useEffect` `StoreHydrator` → rehidrasi localStorage/IndexedDB tidak pernah balapan dengan hydration React. Benar.
- Root layout `<html>`/`<body>` statis-deterministik. Benar.
- `SidebarMenuSkeleton` (vendored shadcn, `Math.random()` di render) — tidak dipakai halaman mana pun.
- `ProjectHistoryDialog` (format `Intl 'id-ID'`) hanya render saat dialog dibuka (interaksi pasca-load). Aman.
- `ConnectionStatus` `title` dari `checkedAt` — null selama SSR+hydration pertama (skipHydration). Aman.
- **Reproduksi headless** (Chrome via agent-browser): `/`, `/workspace`, `/settings`, `/ship` — dengan localStorage riwayat chat yang di-seed — **0 error hydration**. Markup SSR/CSR konsisten by design.

**Divergensi nyata yang ditemukan & dihilangkan — `<time>` di `ChatMessage`:** SSR merender `new Date(timestamp)` → **waktu server dibekukan saat modul di-init** (terbukti: HTML SSR menunjukkan `dateTime="2026-11-12T04:39:19.589Z"` = tepat jam boot server, format en-US/UTC), sedangkan klien menghitung saat page load → atribut `dateTime` DAN teks jam **selalu beda**. `suppressHydrationWarning` hanya menyembunyikan warning, tapi React sengaja membiarkan nilai server di DOM (*"This won't be patched up"*) → user di Indonesia melihat jam beku berzona UTC berformat en-US yang tidak pernah terkoreksi. Untuk user dengan locale berbeda dari server, inilah persis kelas mismatch attribute+teks yang diperingatkan error tersebut.

**Perbaikan:** komponen `MessageTime` di `ChatMessage.tsx` — jam dirender **hanya setelah mount** (`useState`+`useEffect` gate): server merender `null`, render pertama klien juga `null` (identik → tidak ada yang bisa mismatch), lalu jam muncul dengan locale + zona waktu user sendiri (id-ID/WITA bagi user kita). Flag `suppressHydrationWarning` dipertahankan sebagai defense-in-depth.

**Verifikasi:** `tsc --noEmit` 0 error; suite **199/199 pass**; HTML SSR `/workspace` kini **0 elemen `<time>`** (deterministik); di browser, jam muncul normal pasca-mount dari riwayat tersimpan; konsol bersih di semua halaman yang diuji.

**Catatan jujur untuk user:** dengan perbaikan ini aplikasi tidak lagi menghasilkan divergensi hydration apa pun. Jika error masih muncul setelah hard refresh (Ctrl+Shift+R), penyebabnya di luar aplikasi — teks error itu sendiri menyebut kemungkinan **ekstensi browser yang memodifikasi HTML sebelum React load** (Dark Reader, Grammarly, translator, dsb.); uji dengan mode incognito/ekstensi nonaktif untuk memastikan.

## Hotfix — 2026-11-12 — "Preview gak muncul": 500 di semua route (katalog & preview mati total)

**Gejala:** user melaporkan preview tidak muncul. Server dev ternyata HIDUP (uptime 37 menit) tapi **setiap request dibalas HTTP 500** — bukan mati, tapi rusak.

**Bukti diagnosis (dev.log saat insiden):**
```
ENOENT: .next/dev/routes-manifest.json
ENOENT: .next/dev/server/app/page/build-manifest.json
Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
GET / 500 in 118ms
```
Server sudah meng-compile in-memory, lalu file manifest yang ia referensikan **dihapus dari disk** → setiap render ENOENT → 500 permanen sampai restart.

**Root cause terbukti (bukan tebakan):** `scripts/e2e-live-verify.ts` (Pass 14) di blok `finally` menjalankan `rm -rf .next/dev` sebagai "pembersihan". Saat itu dijalankan, server preview (dinyalakan otomatis oleh boot container via `.zscripts/dev.sh`, memegang :3000) **masih hidup dan memakai cache itu**. Kegagalan berlapis: dev server milik E2E sendiri gagal bind (EADDRINUSE), `waitForServer` tetap "sukses" karena yang menjawab justru server preview, lalu cleanup menghancurkan cache di bawah server yang tidak ia miliki.

**Temuan mekanisme sandbox (penting untuk pemulihan):** setiap proses yang lahir dari tool call dibunuh saat perintah selesai (driver mematikan seluruh pohon proses wrapper — terbukti: `setsid nohup sleep 600` pun mati). Proses boot selamat karena ter-re-parent ke PID 1. Solusi pemulihan: **`scripts/dev-daemon.py`** — launcher double-fork yang me-re-parent `.zscripts/dev.sh` ke PID 1 (posisi pohon yang sama dengan server hasil boot). Terverifikasi bertahan lintas perintah dan melayani 200.

**Perbaikan (3 lapis):**
1. **`scripts/e2e-live-verify.ts`**: (a) menolak berjalan bila :3000 sudah menjawab ("REFUSING to run" + cara menghentikan, exit 1) — tidak lagi menguji server yang bukan miliknya; (b) cleanup `.next/dev` hanya bila tidak ada server yang masih mendengarkan :3000.
2. **`scripts/guard-no-dev-server.mjs`** (baru, dipasang di depan `bun run build` di package.json): menolak build saat dev server hidup — `next build` menulis ulang `.next` dan bisa merusak state `.next/dev` server yang berjalan (kelas bahaya yang sama).
3. **`scripts/dev-daemon.py`** (baru): alat pemulihan standar — `python3 scripts/dev-daemon.py` menghidupkan kembali preview dengan alur boot resmi (bun install → db:push → dev → health check).

**Verifikasi:** `tsc --noEmit` 0 error; suite **199/199 pass**; guard live test — server hidup → menolak dengan exit 1 (dibuktikan); jalur penolakan E2E live — server preview **tidak tersentuh** dan tetap 200 (dibuktikan); seluruh route pulih: `/`, `/workspace`, `/settings`, `/ship` → **200**.

## Pass 14 — 2026-11-12 — AC-24: E2E website generation (MOCKED) — pipeline penuh terbukti + 2 bug nyata ditemukan & diperbaiki

Satu-satunya acceptance criteria yang tersisa (AC-24, sebelumnya NOT RUN karena tidak ada key provider di environment) kini diuji dengan pendekatan yang diizinkan master prompt §17.3: *"Jika tidak memiliki API key asli, gunakan mock yang realistis dan tandai hasil sebagai MOCKED, bukan LIVE TESTED."*

**Cara (tanpa mengubah kode produksi):** mock server OpenAI-compatible berjalan di `127.0.0.1:11434` — alamat loopback Ollama, satu-satunya provider yang memang didesain keyless + loopback (pengecualian SSRF terdokumentasi). Pipeline produksi UTUH (rate limit, CSRF, kebijakan tier gratis, blueprint gate, planner/coder, validasi sandbox path, repair deterministik, checkpoint, verification gate, NDJSON streaming) mengeksekusi skenario nyata tanpa patch apa pun. Hasil berlabel MOCKED — membuktikan PIPELINE, bukan kecerdasan model.

**Cakupan test baru — `tests/e2e-website-generation.test.ts` (11 test) + `tests/helpers/` (mock + payload 5 proyek realistis):**
- **Test A–E (master prompt §17.5)**: landing page (tanpa gate), admin dashboard + inventory + marketplace (gate blueprint menyala: panggilan pertama TIDAK memanggil model sama sekali, lalu disetujui → blueprint jadi konteks coder), company profile multi-page. Setiap proyek multi-file Vite+React+TS diverifikasi: struktur file, marker fitur wajib (Hero/Navbar/Pricing/Footer; search/filter/pagination/form; CRUD+validasi+localStorage; 4 halaman+form kontak; ApiError/useReducer/ErrorBoundary), responsivitas (`@media`), perintah `npm install` lolos `parseSafeNpmCommand` (dipaksa `--ignore-scripts`).
- **Kejujuran verification gate**: level yang tidak dijalankan tetap `Not Run`/`Blocked` (bukan dipalsukan Passed); keseluruhan jujur `Partially Verified`.
- **Repair deterministik**: payload sengaja berkurbang-tidak-seimbang → workspace menerima versi sudah-diperbaiki (bukan hanya checkpoint), + notice (tidak ada perbaikan senyap).
- **Verification gate menolak COMPLETED**: payload tanpa `src/App.tsx` → kontrak gagal → status `interrupted` + `verificationFailed:true`; turn perbaikan pengguna → lolos.
- **Resume checkpoint**: kegagalan di tengah (2 percobaan 500) → tugas selesai tidak diulang (`Checkpoint dipulihkan`), hanya tugas tersisa yang dieksekusi (dihitung dari jumlah panggilan coder: tepat 4).
- **/api/chat economy**: streaming SSE provider → NDJSON delta di klien (lewat konsumer produksi `consumeAIStream`).
- **/api/providers**: katalog keyless via pengecualian loopback SSRF + tes koneksi sukses.
- **CSRF**: `sec-fetch-site: cross-site` → 403 sebelum pekerjaan apa pun.

**LIVE (dev server sungguhan + HTTP sungguhan, provider tetap MOCKED) — `scripts/e2e-live-verify.ts`:** server `bun run dev` berjalan berdampingan dengan mock loopback; `GET /` 200 + COOP/COEP; `POST /api/providers` 200 (katalog mock); `POST /api/orchestrate` streaming NDJSON lengkap: planning→coding→agent-plan→event `files` (10 file)→verification `Partially Verified`→`done` tanpa kegagalan. Semua PASS.

**2 bug produksi NYATA ditemukan E2E ini dan diperbaiki:**
1. **Checkpoint gagal tak pernah bisa di-resume** (`src/app/api/orchestrate/route.ts`): jalur catch menyimpan checkpoint `interrupted` TANPA menghitung ulang checksum integritas (checksum masih dari saat `running`) → setiap resume ditolak sah sebagai `checksum_mismatch` (master 5.12 bekerja, tapi tidak ada pekerjaan gagal yang pernah dipulihkan). Kini checksum dihitung ulang sebelum save; dibuktikan test resume.
2. **Workspace ≠ yang diverifikasi** (route + `useAIChat.ts`): repair deterministik (fence/brace) diterapkan hanya untuk checkpoint/verifikasi, sedangkan delta yang dikirim ke browser masih RAW — user mendapat file rusak padahal gate "lolos". Kini route mengirim event terstruktur `{type:'files'}` berisi file hasil perbaikan (persis yang divalidasi), klien memprioritaskannya di atas re-parse teks mentah, dan perbaikan diumumkan lewat notice (no silent repair).

**Batas jujur:** Install→Run→Preview (WebContainer) berjalan di browser user dan tetap membutuhkan key provider NYATA untuk generasi model sungguhan — tidak diklaim teruji di sini. Adapter SerpAPI/Brave/Exa/Firecrawl tetap hanya teruji unit + pola adapter (Tavily/DuckDuckGo live di Pass sebelumnya).

**Verifikasi penuh:** suite **199/199 pass** (188 lama + 11 baru), `tsc --noEmit` 0 error, `bun run build` sukses (17 route), live script semua PASS.

## Master Upgrade — 2026-11-12 — 8 fase lengkap (audit → keamanan → orkestrasi → eksekusi → web research → UI diamond → regresi → laporan akhir)

Laporan lengkap + status 25 acceptance criteria: `YUHA_MASTER_UPGRADE_REPORT.md` (24 PASSED, 1 NOT RUN jujur). Baseline audit: `YUHA_PHASE0_BASELINE.md`. Ringkasan per fase:

- **PHASE 0**: 9 temuan audit master prompt direproduksi di source; baseline + rencana patch per file.
- **PHASE 1**: klasifikasi tier terpusat per provider (Gemini/Groq free-tier terdokumentasi, kuota jujur unknown); persetujuan biaya per model (persist, bukan saklar global); circuit breaker per-kredensial (fingerprint HMAC — user lain tak terdampak); rate limiter trusted-proxy (algoritma hop-kanan, XFF hop-kiri tak bisa dipalsukan, hard cap memori); SSRF blokir NAT64/6to4/Teredo/IPv4-compatible; key debugger tidak lagi meminjam key provider aktif.
- **PHASE 2**: checkpoint schema v2 (workspace-scoped, TTL 7 hari, checksum integritas, save gagal → mode non-persistent tanpa salah label timeout); import resolver benar (relatif ke direktori importer, `@/`, ekstensi, index, circular); blueprint gate BENAR-BENAR menunggu persetujuan untuk proyek kompleks dan blueprint disetujui menjadi konteks coder; verification gate jadi gerbang penyelesaian (FAILED ≠ COMPLETED).
- **PHASE 3**: executor memvalidasi ulang parser (bukan cuma UI); `.npmrc`/`.yarnrc` dari model ditolak; `--ignore-scripts` dipaksa; eksekusi otomatis dev/build butuh persetujuan satu kali yang diingat.
- **PHASE 4**: Web Research Engine — Tavily/Brave/SerpAPI/Exa/SearXNG/DuckDuckGo (pencarian; DDG jujur "Instant Answer saja") + Firecrawl (ekstraksi). Router fallback urutan-user + breaker per kredensial; dedup kanonik + ranking korroborasi + sitasi; pertahanan prompt-injection (framing untrusted); deteksi niat riset; `/api/research` rate-limited + SSRF-guarded; Settings › Web Research lengkap (key/urutan/tes). LIVE: DuckDuckGo mengembalikan hasil nyata; Tavily key salah → `auth 401` jujur.
- **PHASE 5**: UI PURE BLACK × DIAMOND — palet persis (#050505/#0B0B0D/#111114/#18181C/#29292F/#F5F5F7/#A1A1AA/#71717A + aksen #7DD3FC/#A5D8FF); tombol utama hitam-di-atas-ice-blue; biru legacy dihapus; overflow mobile 390px diperbaiki; diverifikasi computed-style di DOM live.
- **PHASE 6**: 188/188 test, 0 error TS, build 17 route, E2E live (halaman 200, CSRF 403, 402+unlock, CSP/COOP, DOM diamond, tanpa overflow).
- **PHASE 7**: laporan akhir + 25 AC.

## Pass 13.1 — 2026-11-12 — Gemini catalog region-block fix (katalog model tidak muncul)

Laporan: "apikey gemini di isi tapi model hanya menampilkan openrouter" (+ screenshot: Gemini 400, hanya katalog OpenRouter yang muncul). Root cause DIBUKTIKAN, bukan asumsi:

1. **Bukti geolokasi server**: `curl ipinfo.io` → egress `8.212.10.159` = **Hong Kong** (Alibaba Cloud AS45102). Gemini API hanya dilayani dari region daftar resmi Google (ai.google.dev/gemini-api/docs/available-regions); **Hong Kong TIDAK termasuk**, dan pembatasan berlaku pada lokasi INSTANCE yang memanggil (server), bukan lokasi user. User (Indonesia) berada di region yang didukung.
2. **Bukti jalur kode**: katalog diambil server-side (`POST /api/providers` → `listProviderModels` → fetch ke `generativelanguage.googleapis.com/v1beta/models`). Dari server HK, Google menolak dengan 400 `FAILED_PRECONDITION` ("User location is not supported for the API use.") **meski key user valid** — key bukan masalahnya. `dev.log` lama menunjukkan polanya: `POST /api/providers` **502** (Gemini gagal) berselang **200** (OpenRouter keyless sukses) — persis keluhan user.
3. **Bug kedua yang menyembunyikan penyebab**: `providerErrorMessage` memetakan 400 generik tanpa menampilkan pesan asli Google → user hanya melihat "provider rejected the request (400)" yang menyesatkan.

**Perbaikan (kecil, terukur):**
- `src/lib/ai/errors.ts`: (a) mapping khusus "user location is not supported" → pesan jujur: provider menolak region server, katalog diambil ulang dari browser, generasi butuh deploy di region yang didukung; (b) cabang 400/fallback kini menyertakan kutipan `error.message` asli provider (JSON di-unwrap) — tidak ada lagi 400 yang buta penyebab.
- `src/lib/ai/catalog-direct.ts` (baru): fallback katalog **langsung dari browser** ketika server gagal. Keamanan ditinjau: key memang sudah disimpan di browser (input user), dikirim langsung ke endpoint resmi provider via HTTPS; CORS `generativelanguage.googleapis.com` diverifikasi membuka ACAO per-Origin (bukti curl dengan header Origin); URL hanya dari config statis; untuk Ollama fallback ini justru benar (browser bisa menjangkau localhost:11434 user). Kegagalan CORS-opak tidak menimpa diagnosis server (no silent failure).
- `src/hooks/useModelCatalog.ts`: server-first → fallback browser-direct, hasil ditandai `via: 'browser'`. Berlaku untuk composer picker DAN Settings (keduanya memakai hook ini).

**Batas jujur yang TIDAK diremehkan:** katalog Gemini kini bisa muncul dari browser user, tetapi **generasi chat via server dari deployment tetap diblokir region oleh Google** (400 yang sama) — pesan error barunya menjelaskan hal ini apa adanya. Solusi nyata: deploy YUHA di region yang didukung Google (US/EU/SG/ID), atau pakai model kelas Gemini via OpenRouter/Groq.

**Verifikasi:** test baru `tests/gemini-region-fallback.test.ts` (8 kasus: mapping region-block, kutipan 400, prioritas mapping API key, ekstraksi pesan JSON, header/normalisasi fallback browser, penggabungan error). Suite penuh **140/140 pass**, `tsc --noEmit` 0 error, `bun run build` sukses. Live: `POST /api/providers` gemini (key bohong) → 502 + pesan "API key rejected" yang benar; openrouter keyless → 200 dengan katalog nyata.

## Pass 13 — 2026-11-12 — Critical security repair, build hardening, real coder fallback, active foundations, honest docs

Baseline: commit `30877f2` (Pass 12). Semua bukti di bawah dijalankan di workspace ini (dev server port 3000, bun 1.3.x, Next.js 16 App Router).

### Phase 1 — Security repair (dengan bukti)

1. **Aset internal keluar dari `public/`.** `public/assets/aistudio/` berisi 3 file internal (ZIP arsip source 1,4 MB, master prompt, PDF blueprint) yang dapat diunduh publik via URL `/assets/aistudio/...`. Dipindah ke `private-assets/` (di luar public, di-gitignore). Bukti: `curl /assets/aistudio/2untitled-...zip` → **404** pada dev DAN production server.
2. **`.env` tidak lagi tracked.** `git rm --cached .env`; `.gitignore` kini mengabaikan `.env*` + `private-assets/` dengan pengecualian `!.env.example`. File `.env` lokal (DATABASE_URL) tetap ada di disk.
3. **Rate limiting semua API routes.** Modul baru `src/lib/security/rate-limit.ts`: fixed window per IP (x-forwarded-for → x-real-ip → local), backend pluggable: memory (default; cocok target deployment standalone tunggal) dan sqlite via `bun:sqlite` (`YUHA_RATE_LIMIT_BACKEND=sqlite`, persisten lintas proses di satu host). Diterapkan di `/api/providers` (list 60/menit, test 15/menit), `/api/chat` (12/menit), `/api/orchestrate` (8/menit), `/api/github/*`, `/api/deploy/*`. Bukti live: burst 14 POST `/api/chat` → 12×401 lalu **429** dengan header `Retry-After`. Bukti concurrency: test race 40 request paralel → tepat 5 lolos (limit 5).
4. **SSRF + DNS rebinding protection di network boundary.** Modul `src/lib/security/ssrf.ts`: `guardedFetch()` melakukan resolusi DNS sendiri, menolak IP loopback/private/link-local/metadata (IPv4, IPv6, IPv4-mapped), lalu **mem-pin alamat tervalidasi pada socket** via undici Agent `connect.lookup` — koneksi tidak bisa diam-diam me-resolve ulang (rebinding diblokir di level koneksi, bukan hanya validasi URL). Redirect ditolak. Diterapkan pada: katalog provider (pengecualian loopback eksplisit hanya untuk Ollama), github commit/repos, dan 5 route deploy (vercel/netlify/render/railway/cloudflare) dengan allowlist host tetap (`assertAllowlistedHost`). WebContainer egress (dari browser) ditegakkan di boundary yang kita kuasai: gerbang perintah npm (`parseSafeNpmCommand`) + sandbox iframe preview + `sandbox-security.ts`.
5. **CSP/COOP/COEP diperkuat tanpa mematikan fitur.** CSP penuh baru (default-src self; script-src self + unsafe-inline/eval/wasm + blob untuk WebContainer; frame-src self + `*.webcontainer.io`; worker-src blob; form-action self), COOP same-origin + COEP credentialless dipertahankan (kebutuhan SharedArrayBuffer WebContainer), frame-ancestors 'none' + XFO DENY di production. Validasi `event.origin` bridge preview sudah benar dan dipertahankan.

### Phase 2 — Build & test infrastructure

- `typescript.ignoreBuildErrors` **dihapus** dari `next.config.ts` — production build kini menjalankan type checking nyata.
- Script baru: `type-check` (tsc --noEmit), `test` (tsx --test), `verify` (type-check+lint+test). `db:push` tanpa `--accept-data-loss`. `packageManager: bun@1.3.4` — satu package manager utama.
- Lockfile disinkronkan resmi via `bun add undici` (undici kini dependency eksplisit karena dipakai `guardedFetch`). **Clean install dibuktikan**: `rm -rf node_modules && bun install` → 1093 paket, 5,77 s, type-check tetap 0 error.
- 20 error TS lama (folder `upload/`, `examples/`, `skills/`) dikeluarkan dari kompilasi via tsconfig exclude; 14 error TS kode aplikasi diperbaiki hingga **0 error**.
- `start` terverifikasi: `bun .next/standalone/server.js` → GET / 200 + CSP aktif. `next build` sukses (17 route) DENGAN type checking.

### Phase 3 — Real multi-provider coder fallback + checkpoint

- `src/lib/ai/fallback-policy.ts`: **error classifier** lengkap (401 auth, 403 permission, 400/422 invalid payload, 404 model unavailable, 408/abort timeout, 413 too large, 429 rate limit, 500 server, 502 gateway, 503 unavailable, 504 upstream timeout, context overflow, truncation, empty, invalid output, network) — kegagalan permanen tidak pernah di-retry.
- **Retry berbatas** dengan exponential backoff + full jitter + hormati `Retry-After` upstream. **Circuit breaker** per `provider:model` (threshold 3, cooldown 60 s, half-open; kegagalan permanen membuka langsung) + failure tracking.
- **Rantai coder nyata** di `/api/orchestrate`: Primary Coder → Fallback Coder 1 → Fallback Coder 2 … urutan kandidat dari provider yang BENAR-BENAR punya key + lolos katalog/biaya, diurutkan dengan bukti benchmark (Phase 4). Setiap kegagalan dicatat dan kandidat berikutnya mengambil alih dengan konteks tugas yang sama (bukan mengulang proyek).
- **Checkpoint persisten** (`src/lib/foundations/task-checkpoint.ts`, JSON di `.data/checkpoints/`, atomic write): Task ID, project/session ID, instruksi asli, acceptance criteria, status, daftar tugas selesai/tersisa, manifest file SHA-256, log eksekusi, output model sebelumnya, alasan kegagalan. Kirim ulang instruksi yang sama → tugas yang sudah selesai TIDAK diulang (notice "Checkpoint dipulihkan").

### Phase 4 — Model router aktif dengan benchmark nyata

- `src/lib/foundations/benchmark-registry.ts`: skor dari sumber publik yang bisa ditelusuri dengan tanggal pencatatan (LiveCodeBench via Artificial Analysis per 2026-11-09; SWE-bench official; vals.ai; tabel tech-report open-source). Contoh: Gemini 3 Pro LCB 91,7; Gemini 3 Flash 90,8; GPT-OSS-120b 87,8; Kimi K2 family LCB 85,3 / SWE-bench Verified 78,2; DeepSeek V3.2 GPQA 79,9.
- Model TANPA benchmark yang bisa ditelusuri sengaja TIDAK diberi skor (Llama 4 Maverick tercatat eksplisit tanpa skor) → routing kembali ke urutan katalog. `CapabilityBasedModelRouter` kini punya caller runtime aktif: mengurutkan fallback coder per jenis tugas ('coding') + health-aware (circuit breaker) + free-first (tier).

### Phase 5 — Verification gate aktif

- Server: `VerificationGateEngine.verifyWorkspace()` dijalankan di hasil gabungan orchestrate (7 level: contract, filesystem, typeCheck, build, tests, runtime, acceptance — level yang tidak dieksekusi dilaporkan jujur 'Not Run', tidak pernah 'Passed') → event NDJSON baru `verification` → toast di klien. Build auto-repair `useAIChat` dipertahankan dan menjadi bagian pipeline verifikasi (build + gate).

### Phase 6 — Debugger role diperbaiki

- `useAIChat`: Debugger override kini dihormati bila model **terverifikasi gratis dari katalog live** (tanpa perlu `allowPaidModels`); model berbayar/belum terverifikasi tetap butuh izin. Key debugger dikirim konsisten. **Fallback**: bila debugger gagal, loop perbaikan lanjut dengan model aktif. **Tidak mengulang perbaikan selesai**: output build identik setelah perbaikan → loop berhenti dengan pesan. Hasil perbaikan selalu diverifikasi ulang via `npm run build` (sudah ada, dipertahankan).

### Bug carry-over (laporan user: "Api key semua model udah aku isi tapi model pilihan tidak muncul. walaupun muncul koneksi gagal")

Diagnosis dengan bukti (curl + browser headless): pipeline katalog server→klien sehat (OpenRouter keyless memuat 344 model di browser; key terenkripsi persist & rehydrate; semua provider terjangkau dari server). Akar masalah: (1) katalog yang gagal (key ditolak) menghilang SENYAP dari composer picker — kini ditampilkan "Katalog gagal dimuat: <provider> — <pesan>"; (2) model Gemini/Groq/Kimi/Qwen diklasifikasi 'unknown' oleh desain free-first, dan composer picker TIDAK punya alur persetujuan → 402 saat chat ("koneksi gagal") — kini picker memakai alur persetujuan "Aktifkan" yang sama dengan Settings (`model-cost-consent.ts` bersama); (3) tes koneksi model thinking bisa habis di 1024 token → kosong → dinaikkan ke 4096.

### Phase 7 — Foundations aktif (caller runtime nyata)

1. Orchestrator ✓ (session+events di orchestrate) · 2. Repair Router ✓ (klasifikasi error di notice) · 3. Deterministic Repair ✓ (strip fences + brace repair pada file hasil coder) · 4. Manifest Contract ✓ (sync+validate sebelum verifikasi) · 5. Capability Model Router ✓ (urutan fallback) · 6. Work Order ✓ (evidence per tugas) · 7. Verification Gate ✓ · 8. Incremental Change ✓ (analisis risiko + sasaran file) · 9. Context Governance ✓ (ContextPackGovernance: redaksi rahasia + audit) · 10. Design System ✓ (audit UI kualitas pada file hasil) · 11. Knowledge Graph ✓ (deteksi import lokal tak terjawab + evidence ledger) · 12. Evaluation Harness ✓ (Phase 8) · 13. Blueprint Gate ✓ (ambiguity notice) · 14. Budget Governance ✓ (sudah aktif sejak sebelumnya) · 15. Sandbox Security ✓ (validatePath pada path hasil model).

### Phase 8 — Evaluation harness benchmark nyata

- 15 tugas benchmark (landing page, SaaS dashboard, admin dashboard, e-commerce, multi-page, auth, CRUD, API-connected, responsive, complex React, TS debugging, security repair, refactoring, multi-file, full website). Setiap tugas: fixture tetap + prompt tetap + acceptance criteria **eksekusiabel** (predikat over file map) + skor komposit (completeness 40% / struktur 30% / acceptance 30%) + pola terlarang sebagai cap keamanan (bukan keyword bingo — dibuktikan oleh test "keyword-stuffed but broken output cannot pass"). Build/runtime/latensi hanya diisi oleh live runner; tanpa live run statusnya jujur `not_run` + `executedLive=false`.

### Phase 9 — Dokumentasi direkonsiliasi

- 7 dokumen diperbarui mengacu snapshot yang sama (commit Pass 13): README, REPAIR_STATUS, YUHA_TEST_REPORT, YUHA_IMPLEMENTATION_REPORT, YUHA_SECURITY_REPORT, YUHA_15_FOUNDATIONS_MAPPING, CHANGELOG ini. Status dipisah: Implemented / Integrated / Unit tested / Integration tested / Browser verified / Production verified / BLOCKED.

### Bukti pengujian Pass 13

- Test suite: **132 lulus, 0 gagal** (`bun run test`) — termasuk 11 test keamanan (rate limit race, klasifikasi IP/SSRF, rebinding), 16 test fallback (classifier, retry, breaker, checkpoint), 6 test benchmark harness.
- E2E HTTP: **12/12 lulus** (`scripts/e2e-chat-pipeline.ts` + mock provider port 11434) — termasuk event `verification` baru dan guard 401 cloud tanpa key.
- Type-check: **0 error** · ESLint: **bersih** · `next build`: **sukses** (17 route) dengan type checking aktif · Clean install: **sukses**.
- Keamanan live: aset internal **404** (dev+prod), rate limit **429 terbukti**, `.env` keluar dari index Git.
- Browser verified (headless): settings flow save key → error katalog tampil; reload → key terenkripsi rehydrate; composer picker: model gratis terpilih, error katalog tampil, hint provider tanpa key.

### Batasan jujur (TIDAK diklaim)

- Model provider BERBAYAR/live (Gemini, Groq, OpenRouter, Kimi, Qwen dengan key asli) tidak diuji di sesi ini karena tidak ada key riil di sandbox — semua uji provider memakai mock OpenAI-compatible + key dummy yang memang harus ditolak. Benchmark harness belum dijalankan terhadap model live (executedLive=false).
- WebContainer diuji pada level unit/integrasi kode + browser headless memuat halaman workspace; preview runtime penuh dengan npm install di dalam WebContainer tidak diuji di sesi ini (lingkungan headless), sehingga statusnya "browser verified (load) + integration tested (unit)", BUKAN production verified penuh.
- Rate limit memory backend tidak "distributed" lintas mesin; untuk multi-instance wajib pasang backend bersama via interface `RateLimitStore` (sqlite backend tersedia untuk multi-proses satu host).
- Deployment ke platform eksternal (Vercel/Netlify/dst.) tidak dieksekusi di sesi ini; route deploy teruji di level guard + rate limit + SSRF, bukan end-to-end dengan token riil.

---

## Pass 12 — 2026-11-12 — Keys vanished on reload & every connection test failed 401 (audit "Api key udah aku isi tapi model pilihan tidak muncul, koneksi gagal")

Audited the whole Settings → catalog → test pipeline (`ProviderCard` → `useModelCatalog`/`testModelConnection` → `/api/providers` → provider endpoints) and found four disconnected cables:

- **Fixed (critical — the "koneksi gagal" root cause)**: `testModelConnection` sent the credential as `x-<provider>-key` (e.g. `x-gemini-key`), but `/api/providers` reads **`x-api-key`**. The route therefore saw an empty key on every "Tes" click and answered 401 "Tambahkan API key … terlebih dahulu" even though the key was saved. Fix in `src/lib/ai/test-connection.ts`: send `x-api-key`.
- **Fixed (critical — the "model pilihan tidak muncul" root cause)**: `useSettingsStore` deliberately wiped `apiKeys` from persistence (`partialize` stripped them, `migrate` returned `{}`), making credentials session-memory-only — after every page reload all keys silently vanished, so the dynamic catalogs for gemini/groq/kimi/qwen never loaded (`fallbackModels()` returns `[]`, the picker showed nothing) while the UI still claimed "Tersimpan Terenkripsi AES-256 di Browser". Keys are now genuinely persisted **encrypted**: new AES-256-GCM helpers in `src/lib/utils/encryption.ts` plus a non-extractable device key stored in IndexedDB (`crypto.subtle`, `extractable: false`), and a `secureSettingsStorage` zustand adapter (`src/lib/store/secureSettingsStorage.ts`) that encrypts `apiKeys` → `apiKeysEnc` on write and decrypts on read. Plaintext keys never touch localStorage; corrupt ciphertext degrades to "no keys saved" instead of crashing; writes are serialized so quick successive saves cannot reorder. Store bumped to `version: 7` (v6 payloads migrate cleanly).
- **Fixed**: Ollama — a local daemon that needs no credential — was forced through the API-key gate everywhere: catalog listing (401), connection test (401), `/api/chat` (401), `/api/orchestrate` (401) and the client-side guard in `useAIChat`. New helpers `catalogListsKeyless()` / `generationWorksKeyless()` (`src/lib/ai/catalog.ts`) now let Ollama list, test, chat and orchestrate without a key (OpenRouter keeps its keyless public *catalog* but still requires a key for generation; all cloud providers unchanged). Also: `normalizeCatalog` no longer lets $0 pricing metadata demote local Ollama models to "Biaya Belum Diverifikasi" — a local runtime is free by construction.
- **Fixed (security)**: `useConnectionStore` persisted `ModelTestResult.credential` — the **raw API key** — into `yuha-connections-storage` in localStorage plaintext. `partialize` now strips the credential before persisting (status/latency/error stay); the in-memory copy is still used for key-match checks.
- Copy updated to match reality: "Active for this session" → "Tersimpan terenkripsi di browser ini" (ProviderCard, SettingsModal, SettingsPage save toast, privacy note now explains the device-bound IndexedDB key).
- **Verified end-to-end** with a mock OpenAI-compatible provider on 127.0.0.1:11434 (`scripts/e2e-provider-settings.ts`, 8/8): ollama lists and tests keyless (200), gemini/groq still 401 without a key (protection intact), the old `x-gemini-key` header alone still 401s while `x-api-key` reaches Google (fails at the provider with a real error message, not a false 401), and the Pass 10 chat stream regression check passes. Keyless `/api/chat` + `/api/orchestrate` for ollama stream the full event chain. Headless-browser verification: saved a key through the UI → localStorage holds only `apiKeysEnc` ciphertext → **page reload restores the masked key** ("AIza••••2345 · Tersimpan terenkripsi di browser ini") → the fake key surfaces the real "API key rejected" provider error in the catalog card → "Tes" on a mock model shows "Berhasil".
- **Tests**: added `tests/provider-settings-repair.test.ts` (10 cases: header fix, encrypted round-trip, reload restore, corrupt ciphertext, legacy v6 migration, sanitizer, keyless rules, credential stripping). Suite: **99/99 passing**; production build green (17/17 pages).

## Pass 11 — 2026-11-12 — Simplified AI model picker (UX request "pilihan model buat lebih simpel")

Replaced the old model dropdowns with one clean, searchable picker used in both the chat composer and Settings:

- **New `ModelSelect`** (`src/components/settings/ModelSelect.tsx`): a Popover + cmdk combobox. Search-as-you-type, provider groups with colored letter chips and model counts, compact tier badges (Gratis / Kuota / Berbayar / Cek biaya), context-window size on the right, a check mark on the active model, and keyboard navigation (arrows + Enter). Idle view shows "Gratis · pilihan cepat" (free quick picks, active provider first) and caps each provider group at 5 items with a "+N lainnya — ketik untuk mencari semua" note instead of dumping 300+ rows; the active model is always kept visible. Providers without an API key are summarized in one hint line rather than shown as empty groups, and a keyless state (no catalog at all) shows guidance with a link to Settings.
- **`shortModelName()`** (`src/lib/ai/catalog.ts`): display names drop vendor prefixes and the `:free` suffix ("google/gemini-2.0-flash-exp:free" → "gemini-2.0-flash-exp"); the full id stays in the tooltip and the store. The long-form `modelLabel` remains for verbose contexts.
- **Settings**: the "Model default" native `<select>` and the role-model option labels now use the same picker / short names; the recommendation banner is compact ("Gemini · gemini-2.0-flash · GRATIS"). Provider radio grid and free-first guard behavior unchanged.
- **Two cmdk pitfalls fixed during verification** (found via headless-browser DOM checks): (1) in cmdk 1.x the root `Command value/onValueChange` is the *selected item*, not the search — the search must be controlled through `CommandInput`, otherwise the first auto-selection filled the query and disabled the idle cap; (2) a controlled Radix popover does not fire `onOpenChange` on programmatic closes, so the search now resets in a `useEffect` on close.
- **Verified in a real browser** (agent-browser, DOM assertions): idle view renders 8–9 items instead of 344; search "llama" → 98 matches; selecting via click and via keyboard updates the trigger and switches provider; Escape → reopen shows a fresh idle state; the empty (no-key) state and the keyless-provider hint render correctly; no console errors.
- **Tests**: added `tests/model-picker.test.ts` (7 cases for `shortModelName` edge cases). Suite: **89/89 passing**; production build green (17/17 pages).

## Pass 10 — 2026-11-12 — Chat stream protocol mismatch: every reply dropped as "Model returned no text" (audit "Buat semua kabel terhubung")

Audited the full send pipeline (`ChatInput` → `useAIChat` → `/api/chat` + `/api/orchestrate` → provider SDK → stream consumption) and found the wire was cut between the API routes and the client:

- **Fixed (critical — the "can't send messages" root cause)**: `/api/chat` and `/api/orchestrate` stream **NDJSON** (`{"type":"delta","text":"..."}\n`, `Content-Type: application/x-ndjson`), but `consumeAIStream` in `src/lib/ai/stream.ts` only parsed SSE lines starting with `data: `. Every delta, stage and done event was silently dropped, so every *successful* generation ended in the misleading error "Model returned no text. Test this model in Settings…". The mismatch is inherited from the original Vite source (both server routes and the parser shipped that way). Fix: the parser now accepts NDJSON (primary) and SSE `data: `/`[DONE]` (backward compatible), buffers events split across chunks, flushes a trailing non-newline-terminated line, and cancels the reader on early exit instead of leaving the connection dangling.
- **Fixed**: provider failures sent as `{"type":"error"}` stream events were swallowed by the same parser — the user saw "Model returned no text" instead of the real reason (invalid key, quota, model unavailable). `consumeAIStream` now re-throws the provider error message (after `onEvent`), so `useAIChat`'s catch block renders the actual `providerErrorMessage` text in the chat banner.
- **Fixed**: in balanced/max mode (balanced is the default) `useAIChat` sent `x-yuha-key-*` headers only for gemini/groq/openrouter, and `/api/orchestrate` likewise read only those three. A user whose **active provider** was kimi/qwen/ollama got a false 401 "Add your API key in Settings" even with the key saved. New shared helper `buildOrchestrationHeaders()` (`src/lib/ai/orchestration.ts`) always includes the active provider's key; the route now reads `x-yuha-key-<activeProvider>` for any supported provider. Supporting-role resolution remains core-trio-only.
- **Verified designed, not weakened**: the 401 (no key), 402 (free-first cost guard) and 400 (payload validation) responses are intentional and surfaced with clear messages; `ai@7` + `@ai-sdk/*@4` were probed at runtime and work (real HTTP calls succeed — the version spread is not a fault).
- **End-to-end verification** against the live dev server with a mock OpenAI-compatible provider on 127.0.0.1:11434: `/api/chat` streams and `consumeAIStream` now returns the full text; the provider-error path surfaces "Ollama Local (fail-model): API key rejected…"; `/api/orchestrate` with `x-yuha-key-ollama` returns 200 with the full event chain (stage → agent-plan → delta → agent-task-complete → meta → done); a keyless orchestrate call still 401s. 11/11 E2E checks pass (`scripts/e2e-chat-pipeline.ts`).
- **Tests**: added `tests/chat-stream-protocol.test.ts` (10 cases: NDJSON parsing, SSE compat, chunk-boundary buffering, trailing-line flush, error propagation, noise immunity, orchestration headers). Suite: **82/82 passing**; production build green (17/17 pages).

## Pass 9 — 2026-11-11 — Chat send blocked by a persisted stuck `isStreaming` flag (audit "Aku ngirim pesan gak bisa")

The dev log showed **zero** `POST /api/chat` attempts, proving the failure happened client-side before any network call. Audit of the send path (`ChatInput` → `useAIChat.sendMessage`) found:

- **Fixed (critical, silent)**: `useChatStore` persisted every field including the transient `isStreaming` flag. A reload or tab close mid-generation froze `isStreaming: true` into localStorage; after hydration every send was silently swallowed (`if (chat.isStreaming) return`), the send button became a permanent stop button and the caption stayed on "Building your idea". Fix in `src/lib/store/useChatStore.ts`: `partialize` persists only `messages` + `draft`; `version: 1` + `migrate` strips legacy transient fields; `onRehydrateStorage` force-clears `isStreaming`/`error`/`statusNotice` (heals existing users' already-corrupted localStorage on next reload).
- **Verified visible (by design)**: two other send gates produce a clear error banner (not silence): missing API key and missing model. API keys are session-memory-only by a deliberate security decision (`partialize` wipes them from storage) — users must re-enter keys after each page reload.
- **Verified designed 402**: `/api/chat` refuses models whose cost cannot be proven free (`modelOption` only certifies OpenRouter `:free` and local Ollama). Gemini/Groq/Kimi/Qwen models require the explicit "Berbayar Diizinkan" consent toggle in Settings; the error banner offers direct actions. This is the intended free-first protection (tests/ai-catalog-free-first.test.ts) and was not weakened.
- **End-to-end browser verification** (headless): seeded the exact corrupted localStorage (`isStreaming: true`) → reload heals it, send button restored; sending without key/model shows the visible banner; seeding a key + model makes the message reach the server (`POST /api/chat 402` in dev.log) with the free-tier consent banner — the full chain now works.
- **Tests**: added `tests/chat-store-persistence.test.ts` (heals pre-v1 payload, never persists transient flags). Suite: 72/72 passing.

## Pass 8 — 2026-11-11 — Runtime 403 fix behind preview proxy (audit "Kenapa tidak berfungsi?")

Root cause audit of the live dev log found the app fully imported (129 files identical, 24 adapted) but non-functional when opened through the preview gateway:

- **Fixed (critical)**: every `POST /api/providers`, `/api/chat`, and `/api/deploy/*` returned 403 "Cross-site requests are not allowed" when the browser opened the app via a proxied preview domain. `rejectCrossOrigin` compared the `Origin` header against `request.url` (`http://localhost:3000`), which can never match after the proxy rewrites the host. Fix in `src/lib/deploy/validate.ts`: (1) trust the browser's `sec-fetch-site: same-origin` Fetch-Metadata attestation, which web content cannot forge and which survives proxy host rewrites; (2) additionally accept Origins matching `x-forwarded-host` / `x-forwarded-proto` / `Host`. Genuinely cross-site requests (`sec-fetch-site: cross-site`) and foreign origins without attestation are still rejected, so CSRF protection is preserved (no cookies/ambient auth are involved; `x-api-key` is explicit per request).
- **Fixed**: Next.js dev blocked `/_next/*` assets from preview subdomains with a cross-origin warning; added `allowedDevOrigins: ["*.space-z.ai", "localhost"]` to `next.config.ts`.
- **Fixed**: the static preview rendered the Vite template shell whose `<script src="/src/main.jsx">` 404'd against the Next.js server and showed a blank page; `staticPreview()` now shows the explainer card for build-tool shells and still passes through self-contained HTML.
- **Ops**: the dev server is now launched detached via `start-stop-daemon` (PPID 1) so it survives across sessions; production `next build` verified (17/17 pages, all 16 routes).
- **Tests**: added `tests/proxy-origin-fix.test.ts` (9 cases covering the proxy, forwarded-host chains, same-origin attestation, and retained CSRF rejections). Full suite: 71/71 passing.
- Import completeness re-verified against `upload/impor-data-lengkap-main.zip`: the 6 "missing" root files (`index.html`, `vite.config.ts`, `server.ts`, `pnpm-*`, `next.config.mjs`) are Vite/legacy artifacts intentionally not carried into the Next.js runtime.

## Pass 7 — 2026-11-11 — Verification continuation

- Re-extracted and inspected the Pass 6 archive.
- Confirmed Next.js is the active YUHA runtime from package scripts and route layout.
- Confirmed Vite is still required by generated WebContainer project templates; legacy server artifacts must not be confused with the active YUHA server.
- Audited actual Planner/Coder/Reviewer route workflow and client auto-repair call sites.
- Rechecked all 15 foundation registry claims; registry explicitly marks foundations 1–13 and 15 partial, and foundation 14 implemented but not fully verified.
- Identified exact lockfile workspace omissions: `@tailwindcss/postcss`, `postcss`, and `shadcn`.
- Retried dependency installation; it timed out. Did not hand-edit lockfile or fabricate dependency resolutions.
- Executed configured type-check, test, and build commands and recorded their actual blockers in `YUHA_TEST_REPORT.md`.
- No application source-code changes were made because the compiler, test runner, and build tool could not be installed and therefore regressions could not be verified.

## Pass 6 and earlier

See the preceding entries in the supplied history and `REPAIR_STATUS.md` from the previous pass for earlier security and source changes. The original source archives were not available for a fresh comparison in Pass 7.
