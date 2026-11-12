/**
 * E2E MOCK PROVIDER (Master Prompt 17.3: "Jika tidak memiliki API key asli,
 * gunakan mock yang realistis dan tandai hasil sebagai MOCKED, bukan LIVE").
 *
 * An in-process OpenAI-compatible server bound to the Ollama loopback address
 * (127.0.0.1:11434). YUHA treats Ollama as the documented keyless local
 * runtime, so the REAL production pipeline (rate limits, CSRF guard, tier
 * policy, blueprint gate, planner/coder orchestration, deterministic repair,
 * checkpointing, verification gate, NDJSON streaming) runs unmodified against
 * this mock. ZERO production code is changed for the test.
 *
 * Honesty contract:
 *  - Results produced through this server are MOCKED, never "LIVE TESTED".
 *  - It must never be reachable in any real deployment (loopback only).
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export const MOCK_HOST = '127.0.0.1'
export const MOCK_PORT = 11434
export const MOCK_MODEL = 'yuha-e2e-builder'

export interface MockScenarioTask {
  title: string
  objective: string
  acceptanceCriteria: string[]
  /** boltAction XML payload (files + shell commands) the coder returns. */
  coderResponse: string
}

export interface MockScenario {
  id: string
  /** Unique substring that identifies the scenario inside any prompt. */
  trigger: string
  tasks: MockScenarioTask[]
}

export interface MockCall {
  role: 'planner' | 'coder' | 'reviewer' | 'other'
  /** 1-based AGENT TASK index for coder calls; 0 otherwise. */
  taskIndex: number
  scenario: string
  at: number
}

export interface MockControl {
  scenarios: MockScenario[]
  /** Global coder-call sequence numbers that respond HTTP 500 (failure injection). */
  failCoderCalls: number[]
  calls: MockCall[]
}

export function createMockControl(scenarios: MockScenario[]): MockControl {
  return { scenarios, failCoderCalls: [], calls: [] }
}

let completionSeq = 0

function completionBody(content: string, stream: boolean) {
  const id = `chatcmpl-e2e-${++completionSeq}`
  if (!stream) {
    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MOCK_MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 512, completion_tokens: 256, total_tokens: 768 },
    }
  }
  // Split into realistic SSE chunks (~240 chars each).
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += 240) chunks.push(content.slice(i, i + 240))
  const chunkBase = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MOCK_MODEL,
  }
  const sseChunks: Array<{ id: string; object: string; created: number; model: string; choices: Array<{ index: number; delta: Record<string, string>; finish_reason: string | null }> }> = chunks.map(text => ({
    ...chunkBase,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  }))
  sseChunks.push({
    ...chunkBase,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  })
  return sseChunks
}

function findScenario(control: MockControl, prompt: string): MockScenario | null {
  return control.scenarios.find(scenario => effectiveRequest(prompt).includes(scenario.trigger)) ?? null
}

/**
 * Extract the request the model is actually answering. Orchestrate prompts
 * embed `LATEST USER REQUEST:` (planner) and a `USER: ... / ASSISTANT: ...`
 * conversation (coder); /api/chat sends plain messages. Matching on the LAST
 * user turn keeps a repair follow-up ("perbaiki X") from being routed to the
 * scenario of the original request that is still quoted in the history.
 */
function effectiveRequest(prompt: string): string {
  const userBlocks = [...prompt.matchAll(/(?:^|\n)USER: ([\s\S]*?)(?=\n\nASSISTANT:|\n\n[A-Z][A-Z ]{3,}:|$)/g)].map(match => match[1])
  if (userBlocks.length > 0) return userBlocks[userBlocks.length - 1]
  const latest = /LATEST USER REQUEST:\n([\s\S]*?)(?=\n\n[A-Z][A-Z ]{3,}:|$)/.exec(prompt)?.[1]
  return latest ?? prompt
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

export function startMockOllama(control: MockControl): Promise<Server> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = request.url ?? ''

        // ---- Catalog endpoint (OpenAI-compatible /v1/models) ----
        if (request.method === 'GET' && url.split('?')[0] === '/v1/models') {
          sendJson(response, 200, {
            object: 'list',
            data: [
              { id: MOCK_MODEL, object: 'model', created: 1700000000, owned_by: 'yuha-e2e' },
              { id: 'yuha-e2e-helper', object: 'model', created: 1700000000, owned_by: 'yuha-e2e' },
            ],
          })
          return
        }

        if (request.method !== 'POST' || url.split('?')[0] !== '/v1/chat/completions') {
          sendJson(response, 404, { error: { message: `Mock Ollama has no route ${request.method} ${url}` } })
          return
        }

        const raw = await readBody(request)
        let body: { messages?: Array<{ role: string; content: string }>; stream?: boolean }
        try {
          body = JSON.parse(raw)
        } catch {
          sendJson(response, 400, { error: { message: 'Invalid JSON body' } })
          return
        }
        const prompt = (body.messages ?? []).map(message => message.content ?? '').join('\n')
        const scenario = findScenario(control, prompt)

        // ---- Role routing: mirror the exact prompts /api/orchestrate sends ----
        if (prompt.includes('planning agent for YUHA')) {
          if (!scenario) {
            sendJson(response, 500, { error: { message: 'E2E mock: no scenario triggers in planner prompt' } })
            return
          }
          control.calls.push({ role: 'planner', taskIndex: 0, scenario: scenario.id, at: Date.now() })
          const plan = JSON.stringify({
            tasks: scenario.tasks.map(task => ({
              title: task.title,
              objective: task.objective,
              acceptanceCriteria: task.acceptanceCriteria,
            })),
          })
          if (body.stream === true) {
            const chunks = completionBody(plan, true) as Array<Record<string, unknown>>
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
            for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
            response.write('data: [DONE]\n\n')
            response.end()
          } else {
            sendJson(response, 200, completionBody(plan, false))
          }
          return
        }

        if (prompt.includes('execution agent in a bounded multi-step workflow')) {
          if (!scenario) {
            sendJson(response, 500, { error: { message: 'E2E mock: no scenario triggers in coder prompt' } })
            return
          }
          const match = /AGENT TASK (\d+)\/(\d+)/.exec(prompt)
          const taskIndex = match ? Number(match[1]) : 1
          // Failure injection is scoped to THIS scenario so parallel test
          // scenarios cannot consume each other's fail slots.
          const coderCallNumber = control.calls.filter(call => call.role === 'coder' && call.scenario === scenario.id).length + 1
          control.calls.push({ role: 'coder', taskIndex, scenario: scenario.id, at: Date.now() })
          if (control.failCoderCalls.includes(coderCallNumber)) {
            sendJson(response, 500, { error: { message: `E2E mock injected failure for coder call #${coderCallNumber}` } })
            return
          }
          const task = scenario.tasks[taskIndex - 1]
          if (!task) {
            sendJson(response, 500, { error: { message: `E2E mock: scenario ${scenario.id} has no task ${taskIndex}` } })
            return
          }
          sendJson(response, 200, completionBody(task.coderResponse, false))
          return
        }

        if (prompt.includes('senior code reviewer')) {
          control.calls.push({ role: 'reviewer', taskIndex: 0, scenario: scenario?.id ?? '-', at: Date.now() })
          sendJson(response, 200, completionBody('APPROVE\n\nThe implementation matches the approved blueprint; files are complete and imports resolve.', false))
          return
        }

        // /api/chat (single-model economy path): the whole bolt payload.
        control.calls.push({ role: 'other', taskIndex: 0, scenario: scenario?.id ?? '-', at: Date.now() })
        const fallback = scenario?.tasks[0]?.coderResponse ?? 'OK.'
        if (body.stream === true) {
          const chunks = completionBody(fallback, true) as Array<Record<string, unknown>>
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
          for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
          response.write('data: [DONE]\n\n')
          response.end()
        } else {
          sendJson(response, 200, completionBody(fallback, false))
        }
      } catch (error) {
        sendJson(response, 500, { error: { message: `E2E mock crashed: ${error instanceof Error ? error.message : String(error)}` } })
      }
    })()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(MOCK_PORT, MOCK_HOST, () => resolve(server))
  })
}

/** Close the mock and destroy keep-alive sockets so the process can exit. */
export function closeMockOllama(server: Server): Promise<void> {
  return new Promise(resolve => {
    server.closeAllConnections?.()
    const fallback = setTimeout(() => resolve(), 1500)
    server.close(() => {
      clearTimeout(fallback)
      resolve()
    })
  })
}
