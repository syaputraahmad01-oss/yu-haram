import type { FileMap } from '@/types'

export const VITE_REACT_TEMPLATE: FileMap = {
  'package.json': JSON.stringify(
    {
      name: 'yuha-sandbox',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        'lucide-react': '^1.16.0',
      },
      devDependencies: {
        '@vitejs/plugin-react': '^4.3.4',
        vite: '^6.2.0',
      },
    },
    null,
    2
  ),
  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YUHA Sandbox</title>
  </head>
  <body class="bg-neutral-950 text-neutral-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
  'src/main.jsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`,
  'src/App.jsx': `import React from 'react'

export default function App() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#ededed', fontFamily: 'system-ui, sans-serif', padding: '2rem', textAlign: 'center' }}>
      <div style={{ padding: '2rem', borderRadius: '1rem', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(12px)', maxWidth: '480px' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', margin: '0 0 0.5rem 0', background: 'linear-gradient(to right, #60a5fa, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YUHA Live Workspace</h1>
        <p style={{ color: '#a3a3a3', fontSize: '0.875rem', lineHeight: '1.5' }}>Gunakan panel obrolan di sebelah kiri untuk menghasilkan antarmuka React/Next.js interaktif secara instan.</p>
      </div>
    </div>
  )
}`,
  'src/index.css': `* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0a0a0a; color: #ededed; }`,
  'vite.config.js': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})`,
}

export function staticPreview(files: FileMap): string {
  const html = files['index.html']
  // A build-tool shell (Vite) references entry scripts such as /src/main.jsx that only
  // resolve inside the WebContainer runtime. Serving it statically would render a blank
  // page and fire 404s against the Next.js server, so fall back to the explainer card.
  const referencesSourceEntry = !!html && /<script\b[^>]*\bsrc\s*=\s*["'](?:\/|\.\/)?src\//i.test(html)
  if (html && !referencesSourceEntry) return files['index.html']
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
    <style>
      body { margin: 0; background: #09090b; color: #f4f4f5; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .box { border: 1px solid rgba(255,255,255,0.1); padding: 2rem; border-radius: 0.75rem; background: rgba(255,255,255,0.02); text-align: center; }
    </style>
  </head>
  <body>
    <div class="box">
      <h2>Pratinjau Statis</h2>
      <p style="color:#71717a; font-size: 0.875rem;">Jalankan runtime WebContainer untuk melihat preview live interaktif.</p>
    </div>
  </body>
</html>`
}
