import { streamText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { PROVIDERS } from '@/lib/constants/models'
import { SYSTEM_PROMPT } from '@/lib/ai/prompts'
import { providerErrorMessage } from '@/lib/ai/errors'
import type { AIMessage, ProviderType } from '@/types'

import { buildProjectContext } from '@/lib/ai/orchestration'

export function getClient(provider: ProviderType, apiKey: string, model: string) {
  if (provider === 'gemini') {
    return createGoogleGenerativeAI({ apiKey })(model)
  }
  
  const config = PROVIDERS[provider]
  const effectiveBaseUrl = config?.baseUrl || 'https://api.openai.com/v1'
  // Ollama local doesn't require a key, provide fallback placeholder for SDK
  const effectiveKey = provider === 'ollama' && (!apiKey || !apiKey.trim()) ? 'ollama-local' : apiKey

  return createOpenAI({
    apiKey: effectiveKey,
    baseURL: effectiveBaseUrl,
    name: provider,
  }).chat(model)
}

export function streamChat(options: {
  provider: ProviderType
  apiKey: string
  model: string
  messages: Pick<AIMessage, 'role' | 'content'>[]
  files: Record<string, string>
  signal: AbortSignal
}) {
  const context = buildProjectContext(options.files, 200_000)
  return streamText({
    model: getClient(options.provider, options.apiKey, options.model),
    instructions: SYSTEM_PROMPT + '\n\n' + context.context,
    messages: options.messages,
    maxOutputTokens: 16384,
    abortSignal: options.signal,
    maxRetries: 1,
    onError: ({ error }) => console.error(providerErrorMessage(error, options.provider, options.model)),
    telemetry: { isEnabled: false },
  })
}
