import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy notes (Pass 13 Phase 1e):
//  - 'unsafe-eval' + 'wasm-unsafe-eval' + blob: workers are REQUIRED by the
//    WebContainer runtime (@webcontainer/api boots a Node.js stack in the
//    browser via WebAssembly). Removing them breaks the product, not just a test.
//  - connect-src stays https:+ws because the browser-side WebContainer talks to
//    its own stack endpoints; true egress enforcement lives at the boundaries
//    YUHA owns: guardedFetch (server) and the npm-command allowlist (WebShell).
//  - frame-src allows the WebContainer preview origin (*.webcontainer.io) and
//    blob: (sandboxed srcDoc fallback); the preview iframe is sandboxed and its
//    postMessage bridge validates event.origin against the exact server URL.
//  - Production additionally pins frame-ancestors 'none' + X-Frame-Options DENY.
const cspDev = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  "connect-src 'self' https: http://localhost:* ws: wss:",
  "frame-src 'self' blob: https://*.webcontainer.io",
  "worker-src 'self' blob:",
  "form-action 'self'",
].join('; ');

const cspProd = `${cspDev}; frame-ancestors 'none'`;

const nextConfig: NextConfig = {
  output: "standalone",
  // The preview gateway serves the app on *.space-z.ai subdomains that differ from the
  // internal host Next.js sees, which would otherwise block /_next/* dev assets.
  allowedDevOrigins: ["*.space-z.ai", "localhost"],
  // Pass 13 Phase 2: production builds must run real type checking.
  // The former typescript.ignoreBuildErrors=true flag is removed on purpose.
  reactStrictMode: false,
  images: { unoptimized: true },
  async headers() {
    const headersList = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
      // Cross-origin isolation headers required by WebContainers (SharedArrayBuffer)
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: isProd ? cspProd : cspDev },
    ];

    if (isProd) {
      headersList.push({ key: "X-Frame-Options", value: "DENY" });
    }

    return [{ source: "/:path*", headers: headersList }];
  },
};

export default nextConfig;
