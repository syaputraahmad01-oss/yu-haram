import { resolveImportPath } from '../src/lib/foundations/knowledge-graph'
const nested: Record<string, string> = { 'src/a/b/c/mod.ts': '', 'src/a/shared.ts': '' }
for (const spec of ['../../shared', '.././../a/shared', '../../../a/shared']) {
  console.log(spec, '→', resolveImportPath('src/a/b/c/mod.ts', spec, nested))
}
