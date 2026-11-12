export interface AgentTask {
  id: string
  title: string
  objective: string
  acceptanceCriteria: string[]
}

const MAX_TASKS = 4
const MAX_TITLE = 100
const MAX_OBJECTIVE = 700
const MAX_CRITERIA = 5

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''
}

/** Parse and constrain an LLM-generated plan. Invalid plans safely fall back to one task. */
export function parseAgentTaskPlan(raw: string, fallbackObjective: string): AgentTask[] {
  const fallback: AgentTask[] = [{
    id: 'task-1',
    title: 'Implement the requested change',
    objective: cleanText(fallbackObjective, MAX_OBJECTIVE) || 'Implement the latest user request while preserving existing behavior.',
    acceptanceCriteria: ['Return complete changed files using the supported file protocol.', 'Preserve existing project behavior and avoid unrelated changes.'],
  }]

  const candidates = [raw.trim(), raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? '']
  let parsed: unknown
  for (const candidate of candidates) {
    if (!candidate) continue
    try { parsed = JSON.parse(candidate); break } catch { /* Try the next bounded candidate. */ }
  }
  const source = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { tasks?: unknown }).tasks
    : parsed
  if (!Array.isArray(source)) return fallback

  const tasks: AgentTask[] = source.slice(0, MAX_TASKS).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const title = cleanText(record.title, MAX_TITLE)
    const objective = cleanText(record.objective, MAX_OBJECTIVE)
    if (!title || !objective) return []
    const acceptanceCriteria = Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map(value => cleanText(value, 180)).filter(Boolean).slice(0, MAX_CRITERIA)
      : []
    return [{ id: `task-${index + 1}`, title, objective, acceptanceCriteria }]
  })
  return tasks.length ? tasks : fallback
}

export function formatAgentTask(task: AgentTask, index: number, total: number): string {
  return [
    `AGENT TASK ${index + 1}/${total}: ${task.title}`,
    `OBJECTIVE: ${task.objective}`,
    task.acceptanceCriteria.length ? `ACCEPTANCE CRITERIA:\n- ${task.acceptanceCriteria.join('\n- ')}` : '',
    'Implement only this task and the dependencies it directly requires. Return complete changed files using the required boltArtifact/boltAction file protocol. Do not claim tests or execution that were not performed. Do not run shell commands unless explicitly necessary and allowed.',
  ].filter(Boolean).join('\n\n')
}

/** Keep only a bounded, serializable view of workspace files for subsequent task prompts. */
export function updateAgentFileContext(current: Record<string, string>, changes: Array<{ path: string; content: string }>, maxBytes = 350_000): Record<string, string> {
  const next = { ...current }
  for (const file of changes) {
    if (file.path && typeof file.content === 'string') next[file.path] = file.content
  }
  const output: Record<string, string> = {}
  let bytes = 2
  for (const [path, content] of Object.entries(next)) {
    const entryBytes = new TextEncoder().encode(JSON.stringify(path) + ':' + JSON.stringify(content) + ',').length
    if (bytes + entryBytes > maxBytes) continue
    output[path] = content
    bytes += entryBytes
  }
  return output
}
