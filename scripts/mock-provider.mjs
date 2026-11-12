// Minimal OpenAI-compatible mock provider on port 11434 (Ollama's local port).
// Supports both streaming (streamText) and non-streaming (generateText) calls.
import http from 'node:http'

const server = http.createServer((req, res) => {
  // OpenAI-compatible model catalog (used by the /api/providers "list" action).
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'mock-model', object: 'model', created: 1, owned_by: 'mock', context_length: 8192, pricing: { prompt: '0', completion: '0' } },
        { id: 'mock-model-pro', object: 'model', created: 1, owned_by: 'mock', context_length: 32768, pricing: { prompt: '0.0001', completion: '0.0002' } },
      ],
    }))
    return
  }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    if (payload.model === 'fail-model') {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }))
      return
    }
    if (payload.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
      send({ id: '1', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
      send({ id: '1', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: { content: 'Hello from mock provider. ' }, finish_reason: null }] })
      send({ id: '1', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: { content: 'Stream works end to end.' }, finish_reason: null }] })
      send({ id: '1', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      id: '2', object: 'chat.completion', created: 1, model: payload.model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Mock non-stream response for orchestration.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }))
  })
})

server.listen(11434, '127.0.0.1', () => console.log('mock provider listening on 11434'))
