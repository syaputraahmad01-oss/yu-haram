/**
 * YUHA ARCHITECTURE FOUNDATION 12: Continuous Evaluation Harness (Pass 13 Phase 8)
 *
 * Real project benchmarks, not keyword bingo. Every benchmark task ships:
 *  - a FIXED initial fixture (starter workspace),
 *  - a FIXED prompt,
 *  - executable acceptance checks (predicates over the produced file map),
 *  - and a scoring model composed of file completeness, structural validity
 *    (JSON parse, brace balance, unresolved local imports, forbidden patterns)
 *    and the task's own acceptance predicates.
 *
 * A model does NOT score highly because its output contains a particular word:
 * structural checks fail broken code, missing files and unresolvable imports,
 * and every task's acceptance checks must actually hold. Build/runtime/model
 * latency fields are only filled by a live runner; without a live model run
 * they stay 'not_run' and the result is explicitly marked NOT RUN — never
 * reported as a benchmark pass.
 */

import { ProjectKnowledgeLedger } from './knowledge-graph'

export interface EvaluationBenchmarkTask {
  id: string
  name: string
  category:
    | 'landing_page' | 'saas_dashboard' | 'admin_dashboard' | 'ecommerce'
    | 'multi_page' | 'auth' | 'crud' | 'api_connected' | 'responsive'
    | 'complex_react' | 'ts_debugging' | 'security_repair'
    | 'refactoring' | 'multi_file' | 'full_website'
  /** Fixed starting workspace handed to the model. */
  fixture: Record<string, string>
  /** Fixed instruction. Never reworded between models. */
  inputPrompt: string
  /** Files that must exist and be non-empty after the run. */
  requiredFiles: string[]
  /** Regex-source patterns that must NOT appear (security/anti-pattern caps). */
  forbiddenPatterns: Array<{ pattern: string; flags?: string; reason: string }>
  /** Executable acceptance predicates over the produced file map. */
  acceptanceChecks: Array<{ description: string; test: (files: Record<string, string>) => boolean }>
}

export interface EvaluationResult {
  taskId: string
  modelId: string
  passed: boolean
  score: number // 0-100
  breakdown: { completeness: number; structure: number; acceptance: number }
  diagnostics: string[]
  latencyMs: number | null
  tokenCount: number | null
  buildResult: 'passed' | 'failed' | 'not_run'
  runtimeResult: 'passed' | 'failed' | 'not_run'
  executedLive: boolean
}

const REACT_PKG = JSON.stringify({
  name: 'bench-app', private: true, version: '0.0.1', type: 'module',
  scripts: { dev: 'vite', build: 'vite build' },
  dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
  devDependencies: { vite: '^5.0.0', '@vitejs/plugin-react': '^4.0.0', typescript: '^5.0.0' },
}, null, 2)

const BASE_FIXTURE: Record<string, string> = {
  'package.json': REACT_PKG,
  'index.html': '<!doctype html><html><head><title>Bench App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  'src/main.tsx': "import { createRoot } from 'react-dom/client'\nimport App from './App'\ncreateRoot(document.getElementById('root')!).render(<App />)",
  'src/App.tsx': 'export default function App() {\n  return <main>Bench starter</main>\n}\n',
  'src/index.css': ':root { font-family: system-ui; }\n',
}

const COMMON_FORBIDDEN = [
  { pattern: '\\beval\\s*\\(', reason: 'eval() is forbidden in generated code' },
  { pattern: 'dangerouslySetInnerHTML', reason: 'raw HTML injection is forbidden' },
  { pattern: '(?:password|secret|token)\\s*[:=]\\s*[\'"][^\'"]{6,}[\'"]', flags: 'i', reason: 'hardcoded credentials are forbidden' },
]

function checkBalanced(code: string): boolean {
  let braces = 0, parens = 0
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/(['"`])(?:\\.|(?!\1)[\s\S])*\1/g, ' ')
  for (const ch of stripped) {
    if (ch === '{') braces += 1
    else if (ch === '}') braces -= 1
    else if (ch === '(') parens += 1
    else if (ch === ')') parens -= 1
    if (braces < 0 || parens < 0) return false
  }
  return braces === 0 && parens === 0
}

function unresolvedLocalImports(files: Record<string, string>): number {
  const ledger = new ProjectKnowledgeLedger()
  ledger.buildGraphFromFiles(files)
  let unresolved = 0
  for (const node of ledger.getAllNodes()) {
    for (const dep of node.dependencies) {
      if (!dep.startsWith('.') && !dep.startsWith('@/')) continue
      const base = dep.replace(/^@\//, 'src/').replace(/^\.\//, '').replace(/^(\.\.\/)+/, 'src/')
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`]
      if (!candidates.some(candidate => candidate in files)) unresolved += 1
    }
  }
  return unresolved
}

const has = (files: Record<string, string>, path: string) => typeof files[path] === 'string' && files[path].trim().length > 0
const anyFileMatches = (files: Record<string, string>, pattern: RegExp) =>
  Object.entries(files).some(([path, content]) => pattern.test(path) || pattern.test(content))

export const BENCHMARK_TASKS: EvaluationBenchmarkTask[] = [
  {
    id: 'bench-01-landing-page',
    name: 'Landing page',
    category: 'landing_page',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Turn the starter into a complete product landing page with a sticky navigation bar, a hero section with a call-to-action button, a three-item feature grid, social proof, and a footer with contact links.',
    requiredFiles: ['src/App.tsx', 'src/index.css'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'renders a navigation landmark', test: files => anyFileMatches(files, /<(nav|header)[^>]*>/i) },
      { description: 'has a hero call-to-action button', test: files => anyFileMatches(files, /<button[^>]*>[^<]{0,80}(get started|mulai|coba|start)/i) },
      { description: 'shows at least three feature blocks', test: files => anyFileMatches(files, /features?/i) && anyFileMatches(files, /map\s*\(\s*\w+\s*=>|\.map\(/) },
      { description: 'contains a footer', test: files => anyFileMatches(files, /<footer[^>]*>/i) },
    ],
  },
  {
    id: 'bench-02-saas-dashboard',
    name: 'SaaS dashboard',
    category: 'saas_dashboard',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Build a SaaS metrics dashboard: sidebar navigation, four KPI stat cards (users, revenue, churn, uptime) rendered from an array of data, and a simple bar chart built from divs.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'KPI cards rendered from typed data array', test: files => anyFileMatches(files, /\.map\(/) && anyFileMatches(files, /(users|revenue|churn|uptime)/i) },
      { description: 'has sidebar or nav navigation', test: files => anyFileMatches(files, /<(aside|nav)[^>]*>/i) },
      { description: 'renders a chart from data, not a static image', test: files => anyFileMatches(files, /<(div|svg)[^>]*chart|className=["'][^"']*bar/i) },
    ],
  },
  {
    id: 'bench-03-admin-dashboard',
    name: 'Admin dashboard',
    category: 'admin_dashboard',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Build an admin dashboard with a users table (name, email, role, status), row selection checkboxes, a search input that actually filters rows, and delete buttons with a confirmation step.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'renders a data table', test: files => anyFileMatches(files, /<table[^>]*>/i) },
      { description: 'search input filters displayed rows', test: files => anyFileMatches(files, /filter\s*\(/) && anyFileMatches(files, /type=["']search["']|placeholder=/i) },
      { description: 'destructive action requires confirmation', test: files => anyFileMatches(files, /confirm|window\.confirm|useState.*confirm/i) },
    ],
  },
  {
    id: 'bench-04-ecommerce',
    name: 'E-commerce storefront',
    category: 'ecommerce',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Create a small storefront: product grid from a typed product array, add-to-cart buttons updating a cart count in state, a cart drawer listing items with quantities, and a total price computed from items.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'products rendered from typed array', test: files => anyFileMatches(files, /interface\s+\w*Product|type\s+\w*Product/) },
      { description: 'cart state updates on add', test: files => anyFileMatches(files, /(addToCart|setCart)/) },
      { description: 'total is computed, not hardcoded', test: files => anyFileMatches(files, /reduce\s*\(/) },
    ],
  },
  {
    id: 'bench-05-multi-page',
    name: 'Multi-page website',
    category: 'multi_page',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Extend the starter into a three-page website (Home, About, Contact) with client-side routing state (no external router dependency), a shared navigation that highlights the active page, and a distinct heading per page.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: [...COMMON_FORBIDDEN, { pattern: 'react-router', reason: 'task forbids external router dependency' }],
    acceptanceChecks: [
      { description: 'three distinct pages exist', test: files => anyFileMatches(files, /(home|about|contact)/i) && anyFileMatches(files, /(===|switch\s*\()/) },
      { description: 'active page highlighted in nav', test: files => anyFileMatches(files, /active/i) },
    ],
  },
  {
    id: 'bench-06-auth',
    name: 'Authentication flow',
    category: 'auth',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Add a mock authentication flow: login form (email + password), client-side session state persisted to localStorage, a protected dashboard view that redirects to login when signed out, and a logout button.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'login form with email and password inputs', test: files => anyFileMatches(files, /type=["']email["']/) && anyFileMatches(files, /type=["']password["']/) },
      { description: 'session persisted via localStorage', test: files => anyFileMatches(files, /localStorage\.(setItem|getItem)/) },
      { description: 'protected view gates content', test: files => anyFileMatches(files, /(isAuthenticated|signedIn|user\s*\?)/) },
    ],
  },
  {
    id: 'bench-07-crud',
    name: 'CRUD application',
    category: 'crud',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Build a notes CRUD app: create via form, read in a list, inline edit, and delete. Notes persist to localStorage. Every operation must update typed state, not just the DOM.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'create operation present', test: files => anyFileMatches(files, /(create|add)\w*\(/i) },
      { description: 'update operation present', test: files => anyFileMatches(files, /(update|edit)\w*\(/i) },
      { description: 'delete operation present', test: files => anyFileMatches(files, /(delete|remove)\w*\(/i) },
      { description: 'persisted to localStorage', test: files => anyFileMatches(files, /localStorage\.setItem/) },
    ],
  },
  {
    id: 'bench-08-api-connected',
    name: 'API-connected application',
    category: 'api_connected',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Build a search UI for a public API (e.g. https://api.github.com/search/repositories?q=): debounced input, loading and error states, and results rendered with a retry button on failure. Do not hardcode API keys.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'fetch with abortable/debounced input', test: files => anyFileMatches(files, /(AbortController|setTimeout.*fetch|debounce)/) },
      { description: 'loading state handled', test: files => anyFileMatches(files, /(isLoading|loading|setLoading)/) },
      { description: 'error state with retry', test: files => anyFileMatches(files, /(catch|onError|error)/i) && anyFileMatches(files, /retry/i) },
    ],
  },
  {
    id: 'bench-09-responsive',
    name: 'Responsive interface',
    category: 'responsive',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Make the starter layout responsive: a grid that collapses from 3 columns to 1 under 640px using media queries or Tailwind breakpoints, a hamburger menu on mobile, and images that scale with the viewport.',
    requiredFiles: ['src/App.tsx', 'src/index.css'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'breakpoint or media query defined', test: files => anyFileMatches(files, /@media|sm:|md:|lg:/) },
      { description: 'mobile menu toggle implemented', test: files => anyFileMatches(files, /(hamburger|menuOpen|isOpen|toggle)/i) },
      { description: 'fluid images', test: files => anyFileMatches(files, /max-w-full|w-full|width:\s*100%/) },
    ],
  },
  {
    id: 'bench-10-complex-react',
    name: 'Complex React application',
    category: 'complex_react',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Build a kanban board with three columns, drag-and-drop between columns implemented with pointer events (no external DnD library), optimistic state updates, and an undo for the last move.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: [...COMMON_FORBIDDEN, { pattern: '(?:react-dnd|react-beautiful-dnd|@dnd-kit)', reason: 'task forbids external DnD libraries' }],
    acceptanceChecks: [
      { description: 'three columns rendered', test: files => anyFileMatches(files, /(todo|doing|done)/i) },
      { description: 'pointer-based drag implemented', test: files => anyFileMatches(files, /(onDragStart|onPointerDown|draggable)/) },
      { description: 'undo of last move exists', test: files => anyFileMatches(files, /undo/i) },
    ],
  },
  {
    id: 'bench-11-ts-debugging',
    name: 'TypeScript debugging',
    category: 'ts_debugging',
    fixture: {
      ...BASE_FIXTURE,
      'src/App.tsx': "type User = { id: number; name: string; email?: string }\n\nconst users: User[] = [\n  { id: 1, name: 'Ana' },\n  { id: '2', name: 'Bo' },\n]\n\nexport default function App() {\n  const emails = users.map(u => u.email.trim())\n  return <ul>{emails.map(e => <li>{e}</li>)}</ul>\n}\n",
    },
    inputPrompt: 'Fix every TypeScript error in src/App.tsx without changing runtime behavior: the literal \'2\' must become a number id, and optional email must be handled safely for display. Return the corrected file.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: [...COMMON_FORBIDDEN, { pattern: ':\s*any\b', reason: 'silencing with any is forbidden' }],
    acceptanceChecks: [
      { description: 'id is numeric', test: files => (files['src/App.tsx'] ?? '').includes('id: 2') },
      { description: 'optional email guarded', test: files => /\?\.|\?\?|typeof/.test(files['src/App.tsx'] ?? '') },
      { description: "no raw '2' string id left", test: files => !/id:\s*'2'/.test(files['src/App.tsx'] ?? '') },
    ],
  },
  {
    id: 'bench-12-security-repair',
    name: 'Security repair',
    category: 'security_repair',
    fixture: {
      ...BASE_FIXTURE,
      'src/App.tsx': "export default function App() {\n  const token = 'sk-live-9f8ac3d2b1'\n  const html = '<img src=x onerror=alert(1)>'\n  return (\n    <div>\n      <div dangerouslySetInnerHTML={{ __html: html }} />\n      <button onClick={() => fetch('https://api.example.com?key=' + token)}>Load</button>\n    </div>\n  )\n}\n",
    },
    inputPrompt: 'Repair the security defects in src/App.tsx: remove the hardcoded API token (read it from an env-style config constant), remove the raw HTML injection, and render the message as safe text. Keep the Load button working.',
    requiredFiles: ['src/App.tsx'],
    forbiddenPatterns: [...COMMON_FORBIDDEN],
    acceptanceChecks: [
      { description: 'hardcoded token removed', test: files => !/sk-live-/.test(files['src/App.tsx'] ?? '') },
      { description: 'raw HTML injection removed', test: files => !/dangerouslySetInnerHTML/.test(files['src/App.tsx'] ?? '') },
      { description: 'Load button still present', test: files => /<button/i.test(files['src/App.tsx'] ?? '') },
    ],
  },
  {
    id: 'bench-13-refactoring',
    name: 'Existing project refactoring',
    category: 'refactoring',
    fixture: {
      ...BASE_FIXTURE,
      'src/App.tsx': "import { useState } from 'react'\n\nexport default function App() {\n  const [items, setItems] = useState<string[]>([])\n  const [text, setText] = useState('')\n  // 300 lines of mixed concerns would live here in the real fixture\n  return <div onClick={() => { setItems([...items, text]); setText('') }}>{items.join(', ')}</div>\n}\n",
      'src/components/index.ts': '// barrel file — components should be extracted here\n',
    },
    inputPrompt: 'Refactor the starter: extract the item-list rendering into a dedicated component file under src/components/ and import it from App.tsx without changing behavior. Keep the existing state logic in App.',
    requiredFiles: ['src/App.tsx', 'src/components/index.ts'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'a new component file was extracted', test: files => Object.keys(files).some(path => /^src\/components\/\w+\.(tsx|ts)$/.test(path) && files[path].trim()) },
      { description: 'App imports the extracted component', test: files => (files['src/App.tsx'] ?? '').includes('components/') },
      { description: 'state logic remains in App', test: files => /useState/.test(files['src/App.tsx'] ?? '') },
    ],
  },
  {
    id: 'bench-14-multi-file',
    name: 'Multi-file modification',
    category: 'multi_file',
    fixture: BASE_FIXTURE,
    inputPrompt: 'Introduce a shared `formatCurrency(amount: number, currency?: string)` util in src/utils/format.ts, use it in App.tsx to render prices from a small product array, and export it through src/utils/index.ts. All three files must exist.',
    requiredFiles: ['src/utils/format.ts', 'src/utils/index.ts', 'src/App.tsx'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'util implemented with typed signature', test: files => /formatCurrency\s*\(\s*amount:\s*number/.test(files['src/utils/format.ts'] ?? '') },
      { description: 're-exported from utils index', test: files => /formatCurrency/.test(files['src/utils/index.ts'] ?? '') },
      { description: 'used inside App', test: files => /formatCurrency/.test(files['src/App.tsx'] ?? '') },
    ],
  },
  {
    id: 'bench-15-full-website',
    name: 'Full website from one instruction',
    category: 'full_website',
    fixture: BASE_FIXTURE,
    inputPrompt: 'From this single instruction, generate a complete multi-section personal portfolio website: hero with name and role, projects grid from typed data, skills section, contact form with client-side validation, and dark styling — all within the existing Vite React starter.',
    requiredFiles: ['src/App.tsx', 'src/index.css'],
    forbiddenPatterns: COMMON_FORBIDDEN,
    acceptanceChecks: [
      { description: 'hero section with identity', test: files => anyFileMatches(files, /<section[^>]*>|<header[^>]*>/i) },
      { description: 'projects grid from typed data', test: files => anyFileMatches(files, /interface\s+\w*Project|type\s+\w*Project/) },
      { description: 'contact form validated', test: files => anyFileMatches(files, /<form/i) && anyFileMatches(files, /(validate|required|regex|test\()/i) },
      { description: 'dark styling present', test: files => anyFileMatches(files, /(dark|#0[0-9a-f]{2,5}|bg-gray-9|bg-slate-9|background:\s*#1)/i) },
    ],
  },
]

/** Structural pass shared by every task: broken code cannot score well. */
function structuralScore(files: Record<string, string>, diagnostics: string[]): number {
  let score = 100
  const codeFiles = Object.entries(files).filter(([path]) => /\.(ts|tsx|js|jsx)$/.test(path))
  for (const [path, content] of codeFiles) {
    if (!checkBalanced(content)) {
      score -= 30
      diagnostics.push(`Unbalanced braces/parens in ${path}`)
    }
  }
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('.json')) {
      try { JSON.parse(content) } catch {
        score -= 30
        diagnostics.push(`Invalid JSON in ${path}`)
      }
    }
  }
  const unresolved = unresolvedLocalImports(files)
  if (unresolved > 0) {
    score -= Math.min(40, unresolved * 10)
    diagnostics.push(`${unresolved} unresolved local import(s)`)
  }
  return Math.max(0, score)
}

/**
 * Score a produced workspace against a task. Without buildResult/runtimeResult
 * the result is honestly marked executedLive=false with build/runtime 'not_run'.
 */
export function evaluateBenchmarkTask(
  task: EvaluationBenchmarkTask,
  modelId: string,
  producedFiles: Record<string, string>,
  options: { latencyMs?: number; tokenCount?: number; buildResult?: 'passed' | 'failed'; runtimeResult?: 'passed' | 'failed' } = {},
): EvaluationResult {
  const diagnostics: string[] = []

  // 1. Completeness (weight 40)
  const requiredTotal = Math.max(1, task.requiredFiles.length)
  const requiredPresent = task.requiredFiles.filter(path => has(producedFiles, path)).length
  const completeness = Math.round((requiredPresent / requiredTotal) * 100)
  for (const path of task.requiredFiles) if (!has(producedFiles, path)) diagnostics.push(`Required file missing or empty: ${path}`)

  // 2. Structure (weight 30)
  const structure = structuralScore(producedFiles, diagnostics)

  // 3. Forbidden patterns — security cap, not a scored keyword
  let capped = false
  for (const forbidden of task.forbiddenPatterns) {
    const regex = new RegExp(forbidden.pattern, forbidden.flags ?? '')
    for (const [path, content] of Object.entries(producedFiles)) {
      if (regex.test(content)) {
        capped = true
        diagnostics.push(`Forbidden pattern in ${path}: ${forbidden.reason}`)
      }
    }
  }

  // 4. Acceptance predicates (weight 30)
  const passedChecks = task.acceptanceChecks.filter(check => {
    try { return check.test(producedFiles) } catch (error) {
      diagnostics.push(`Check "${check.description}" threw: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  })
  const acceptance = Math.round((passedChecks.length / Math.max(1, task.acceptanceChecks.length)) * 100)
  for (const check of task.acceptanceChecks) {
    if (!passedChecks.includes(check)) diagnostics.push(`Acceptance failed: ${check.description}`)
  }

  let score = Math.round(completeness * 0.4 + structure * 0.3 + acceptance * 0.3)
  if (capped) score = Math.min(score, 40)
  const passed = score >= 70 && !capped && requiredPresent === requiredTotal

  return {
    taskId: task.id,
    modelId,
    passed,
    score,
    breakdown: { completeness, structure, acceptance },
    diagnostics,
    latencyMs: options.latencyMs ?? null,
    tokenCount: options.tokenCount ?? null,
    buildResult: options.buildResult ?? 'not_run',
    runtimeResult: options.runtimeResult ?? 'not_run',
    executedLive: options.buildResult !== undefined,
  }
}

/** Run every benchmark against a produced workspace (used by the CLI runner). */
export function runAllBenchmarks(modelId: string, producedByTask: Record<string, Record<string, string>>, options: Parameters<typeof evaluateBenchmarkTask>[3] = {}): EvaluationResult[] {
  return BENCHMARK_TASKS.map(task => {
    const files = producedByTask[task.id]
    if (!files) {
      return {
        taskId: task.id, modelId, passed: false, score: 0,
        breakdown: { completeness: 0, structure: 0, acceptance: 0 },
        diagnostics: ['No output produced (NOT RUN)'],
        latencyMs: null, tokenCount: null, buildResult: 'not_run' as const, runtimeResult: 'not_run' as const, executedLive: false,
      }
    }
    return evaluateBenchmarkTask(task, modelId, files, options)
  })
}

/* Legacy micro-benchmarks kept for the existing foundations test suite. */
export interface EvaluationBenchmarkTaskLegacy {
  id: string
  name: string
  category: 'syntax' | 'type' | 'react' | 'logic' | 'security'
  inputPrompt: string
  expectedKeywords: string[]
  forbiddenKeywords: string[]
}

export class ContinuousEvaluationHarness {
  public static readonly STANDARD_BENCHMARKS: EvaluationBenchmarkTaskLegacy[] = [
    {
      id: 'bench-1-react-counter',
      name: 'Accessible React Counter',
      category: 'react',
      inputPrompt: 'Build a counter component in TypeScript React with aria-live and increment/decrement buttons',
      expectedKeywords: ['useState', 'aria-live', 'button', 'export function', 'aria-label'],
      forbiddenKeywords: ['class Component', 'var '],
    },
    {
      id: 'bench-2-safe-path',
      name: 'Path Traversal Guard',
      category: 'security',
      inputPrompt: 'Write a TypeScript function to sanitize relative paths and prevent .. traversal',
      expectedKeywords: ['replace', 'split', '..', 'safe', 'boolean'],
      forbiddenKeywords: ['eval', 'child_process'],
    },
    {
      id: 'bench-3-json-manifest',
      name: 'Valid Schema Generator',
      category: 'syntax',
      inputPrompt: 'Generate a JSON object with name, version, and dependencies',
      expectedKeywords: ['"name"', '"version"', '"dependencies"'],
      forbiddenKeywords: ['undefined', 'NaN'],
    },
  ]

  public static evaluateOutput(
    task: EvaluationBenchmarkTaskLegacy,
    modelId: string,
    generatedCode: string,
    latencyMs: number
  ): EvaluationResult {
    const diagnostics: string[] = []
    let score = 100
    for (const kw of task.expectedKeywords) {
      if (!generatedCode.includes(kw)) {
        score -= Math.round(50 / task.expectedKeywords.length)
        diagnostics.push(`Missing expected pattern "${kw}"`)
      }
    }
    for (const fkw of task.forbiddenKeywords) {
      if (generatedCode.includes(fkw)) {
        score -= 25
        diagnostics.push(`Contains anti-pattern or forbidden token "${fkw}"`)
      }
    }
    return {
      taskId: task.id,
      modelId,
      passed: score >= 70,
      score: Math.max(0, score),
      breakdown: { completeness: score, structure: 100, acceptance: score },
      diagnostics,
      latencyMs,
      tokenCount: Math.ceil(generatedCode.length / 4),
      buildResult: 'not_run',
      runtimeResult: 'not_run',
      executedLive: false,
    }
  }
}
