> **Security update — Pass 13 (2026-11-12):** Kontrol baru dengan bukti eksekusi:
>
> 1. **Public asset purge** — `public/assets/aistudio/` (ZIP arsip source, master prompt, PDF blueprint) dipindah ke `private-assets/` (gitignored). Verifikasi: HTTP 404 pada dev DAN production untuk URL lama.
> 2. **`.env` untracked** dari Git; `.gitignore` menutup `.env*` + `private-assets/`, `!.env.example` dikecualikan.
> 3. **Rate limiting** di seluruh API routes (`src/lib/security/rate-limit.ts`): memory backend (target: standalone tunggal) + sqlite backend (`bun:sqlite`, multi-proses satu host). Bukti live: burst 14 → 429 pada request ke-13 dengan `Retry-After`; test race 40 paralel → tepat 5 lolos.
> 4. **SSRF + DNS rebinding** (`src/lib/security/ssrf.ts`): `guardedFetch` melakukan resolusi DNS sendiri, menolak loopback/private/link-local/metadata (IPv4, IPv6, IPv4-mapped), dan **mem-pin alamat tervalidasi pada socket** (undici Agent connect.lookup) sehingga rebinding diblokir di level koneksi; redirect ditolak; allowlist host tetap untuk integrasi (github/vercel/netlify/render/railway/cloudflare); pengecualian loopback eksplisit hanya untuk Ollama. Semua fetch server kini lewat jalur ini.
> 5. **CSP** penuh (script-src self + unsafe-inline/eval/wasm untuk WebContainer, frame-src `*.webcontainer.io`, worker-src blob, form-action self), COOP/COEP dipertahankan, frame-ancestors 'none' + XFO DENY di production. Bridge postMessage preview memvalidasi `event.origin` terhadap URL server persis.
> 6. **WebContainer egress** enforcement tetap di boundary milik aplikasi: gerbang perintah npm (`parseSafeNpmCommand` + `SandboxSecurityLayer`), sandbox iframe, dan `guardedFetch` server — URL validation saja tidak pernah dianggap cukup.
>
> Sisa risiko yang diakui terbuka: backend memory rate limit tidak lintas mesin (multi-instance butuh store bersama); WebContainer tetap mengeksekusi kode model di browser pengguna (isolasinya sandbox browser + COEP, bukan milik server); tidak ada audit secret-scanning penuh atas riwayat Git lama.

# YUHA Security & Isolation Report

> **Audit status — 2026-11-11:** This document records controls visible in source code and gaps found during the repair pass. It is not a security certification. A helper function or test file is not evidence that a control is enforced on every runtime path.

## Active runtime

The repair pass selects the Next.js App Router (`app/`) as the active app/API runtime. `server.ts` and `vite.config.ts` remain legacy/compatibility artifacts and are not started by the updated `dev`/`start` scripts.

## Controls visible in source

- Provider authentication alignment was source-checked against official documentation: Gemini REST requires `x-goog-api-key`, and the active model-catalog request sets that header explicitly. Gemini generation passes the key through `createGoogleGenerativeAI({ apiKey })`; the SDK-emitted header was not observed because dependencies and live credentials were unavailable, so that path remains unverified at runtime. Groq and OpenRouter document `Authorization: Bearer`; the active `createOpenAI({ apiKey, baseURL })` client follows the AI SDK documented behavior of sending `apiKey` in `Authorization: Bearer`. No live credentialed call was performed. Google documentation states that new AI Studio keys default to authorization keys from 28 May 2026 and that standard keys are scheduled to be rejected from September 2026; users with legacy keys should follow the current migration guidance.

- Provider credentials are entered in Settings and kept in in-memory Zustand state for the current page session. Persisted settings explicitly write `apiKeys: {}`; legacy persisted encrypted values are discarded during migration, and the obsolete co-located `yuha-device-key` is removed on rehydration. Economy chat sends the selected provider key in `x-api-key`; the multi-provider orchestration route reads `x-yuha-key-gemini`, `x-yuha-key-groq`, and `x-yuha-key-openrouter`. This reduces at-rest exposure but does not protect against same-origin XSS or malicious browser extensions.
- `buildProjectContext()` excludes dotenv files other than `.env.example`, common credential stores/directories, private-key formats, invalid/absolute paths, and redacts known token patterns before constructing model context. Pattern redaction remains defense-in-depth, not a complete secret scanner.
- Deployment file validation now rejects absolute paths, traversal segments, real `.env*` files, common credential files, private-key files, oversized files, and excessive file counts. Netlify and Vercel App Router routes use the shared validator.
- Same-origin checks reject browser requests marked cross-site and compare the request origin with the application origin when an Origin header is present.
- Static preview iframes use a restricted sandbox. Server-backed WebContainer previews require a different sandbox policy and must be tested separately.
- Production Next.js headers include clickjacking and content-security restrictions configured in `next.config.mjs`.

## Important limitations still open

1. **NPM lifecycle scripts:** the repair pass now applies `--ignore-scripts` to the initial WebContainer dependency install and to AI-proposed npm install/add commands after parsing. Direct user terminal commands remain an intentional user-controlled execution surface; this policy is not a complete sandbox against malicious packages or runtime behavior.
2. **Network egress / SSRF:** `validateNetworkEgress()` now rejects common literal private/loopback/link-local/metadata destinations, IPv6 private ranges, local hostnames, URL credentials, and non-HTTP(S) schemes. It remains a helper only: no evidence shows every WebContainer/browser/server request is forced through it, and DNS names are not resolved here. Treat network egress as not fully controlled.
3. **API rate limiting:** the legacy Express server has an in-memory limiter, but the active Next.js API routes do not yet share a distributed/global rate limiter. Serverless instances can bypass per-process counters.
4. **CSRF:** requests without an Origin header are currently allowed by the shared helper. This may be needed for non-browser clients, but deployment endpoints should be reviewed for the intended client threat model.
5. **Secret handling:** API keys are memory-only and excluded from persisted Zustand state. This reduces local at-rest exposure but does not protect against same-origin XSS. Regex redaction is defense-in-depth, not a complete secret scanner. New credential formats can pass through unless the file is excluded or a pattern is added.
6. **Deployment providers:** API calls and external provider behavior have not been exercised with live credentials in this repair environment.
7. **WebContainer isolation:** browser sandboxing, COOP/COEP, iframe messaging, and preview origins require real browser tests on HTTPS. Static code inspection alone cannot certify isolation.

## Required security verification before production

- Test every deployment endpoint with `.env`, `.npmrc`, private keys, traversal paths, oversized files, and malformed payloads.
- Prove the real WebContainer package-install path applies the command policy and handles untrusted package scripts.
- Test preview isolation and cross-origin messaging in supported browsers over HTTPS.
- Add effective rate limiting for active Next.js routes and define CSRF policy for requests with missing Origin headers.
- Verify secrets are not written to logs, generated artifacts, model context, or deployment archives.
- Perform live provider and deployment integration tests with dedicated test credentials.

## Repair Pass 5 update — source-level controls, verification pending

- API keys are no longer stored in localStorage, even as ciphertext with a co-located key. They are session-memory-only; users must re-enter them after reload.
- Legacy persisted API-key values are dropped on version migration; the obsolete `yuha-device-key` entry is cleared on store rehydration.
- AI context excludes common credential stores, cloud credential directories, service-account/credential JSON, private-key formats, and invalid/absolute paths.
- `safePath()` and `SandboxSecurityLayer.validatePath()` now reject unsafe paths rather than silently rewriting them. WebContainer write/mount/delete call sites reject an empty/invalid result.
- Shared JSON parsing now enforces the byte limit while reading the request stream. `/api/chat`, `/api/orchestrate`, and `/api/providers` use this bounded reader as well as deployment/GitHub routes.
- Network-target helper checks were expanded, but are not a network proxy and do not prove end-to-end SSRF protection.
- Security limitation: in-memory API keys can still be accessed by malicious same-origin JavaScript/XSS; CSP, dependency integrity, origin controls, and runtime isolation remain necessary.

## Repair Pass 6 additions (2026-11-11)

- Added API-boundary validation for untrusted workspace file maps in Chat and Orchestrator routes.
- AI context construction now rejects unsafe paths through the canonical relative-path validator and excludes additional credential/deployment metadata files.
- Expanded common token redaction patterns. Regex redaction is defense-in-depth and cannot guarantee discovery of arbitrary secrets, encoded credentials, custom tokens, or unknown provider formats.
- Remaining security gaps: no complete secret-scanning engine; no enforced network-egress proxy/DNS pinning for WebContainer; no demonstrated distributed rate limiter; no browser E2E evidence; no provider credential/live API evidence.
