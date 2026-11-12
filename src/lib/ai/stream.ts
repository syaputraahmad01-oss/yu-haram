export interface StreamOptions {
  onEvent?: (event: Record<string, unknown>) => void
  onDelta?: (delta: string) => void
}

/**
 * Consume a YUHA model stream and return the full text.
 *
 * The API routes (/api/chat and /api/orchestrate) stream newline-delimited JSON
 * (NDJSON): one JSON event object per line, e.g. {"type":"delta","text":"..."}.
 * The original parser only understood SSE `data: ` lines, so every NDJSON line
 * was silently dropped and every successful generation ended as
 * "Model returned no text". Both line formats are now accepted.
 *
 * Stream events of {"type":"error"} are re-thrown so callers surface the real
 * provider error (invalid key, quota, model unavailable) instead of a
 * misleading "empty response" message.
 */
export async function consumeAIStream(
  response: Response,
  options?: StreamOptions
): Promise<string> {
  if (!response.body) throw new Error('Response body is empty.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let terminated = false

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return // blank line or SSE keepalive
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload) return
    if (payload === '[DONE]') {
      options?.onEvent?.({ type: 'done' })
      terminated = true
      return
    }

    let parsed: Record<string, unknown>
    try {
      const value: unknown = JSON.parse(payload)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return
      parsed = value as Record<string, unknown>
    } catch {
      // Keepalive noise or a truncated final line: never mix raw protocol
      // bytes into the assistant transcript.
      return
    }

    options?.onEvent?.(parsed)
    if (typeof parsed.delta === 'string') {
      fullText += parsed.delta
      options?.onDelta?.(parsed.delta)
    } else if (typeof parsed.text === 'string') {
      fullText += parsed.text
      options?.onDelta?.(parsed.text)
    }
    if (parsed.type === 'error') {
      throw new Error(
        typeof parsed.error === 'string' && parsed.error
          ? parsed.error
          : 'The model stream ended with an error.'
      )
    }
  }

  try {
    while (!terminated) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        handleLine(line)
        if (terminated) break
      }
    }
    // Flush a trailing line that was not newline-terminated.
    if (!terminated && buffer.trim()) handleLine(buffer)
  } finally {
    if (!terminated) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  return fullText
}
