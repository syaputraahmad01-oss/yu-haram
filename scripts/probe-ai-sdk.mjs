// Probe: does ai@7 work with @ai-sdk/*@4 providers?
import { streamText, generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'

const gemini = createGoogleGenerativeAI({ apiKey: 'fake-key-for-probe' })('gemini-2.0-flash')
try {
  const result = streamText({
    model: gemini,
    prompt: 'hello',
    maxRetries: 0,
  })
  for await (const part of result.fullStream) {
    console.log('gemini stream part:', JSON.stringify(part).slice(0, 300))
    break // one part is enough
  }
} catch (error) {
  console.log('GEMINI ERROR:', error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error).slice(0, 500))
}

const groq = createOpenAI({ apiKey: 'fake', baseURL: 'https://api.groq.com/openai/v1', name: 'groq' }).chat('llama-3.1-8b-instruct')
try {
  await generateText({ model: groq, prompt: 'hello', maxRetries: 0, abortSignal: AbortSignal.timeout(8000) })
  console.log('GROQ: no error?')
} catch (error) {
  console.log('GROQ ERROR:', error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : String(error).slice(0, 500))
}
