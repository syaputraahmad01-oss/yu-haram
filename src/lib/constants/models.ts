import type { ProviderConfig, ProviderType } from '@/types'

export const DEFAULT_PROVIDER: ProviderType = 'gemini'
// A model is selected only from the current provider catalog; do not guess a model ID at startup.
export const DEFAULT_MODEL = ''

export const PROVIDERS: Record<ProviderType, ProviderConfig> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    description: 'Google Gemini models through the Gemini API; pricing and access depend on the selected model and account.',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    color: '#3b82f6',
    letter: 'G',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  groq: {
    id: 'groq',
    name: 'Groq Cloud',
    shortName: 'Groq',
    description: 'Ultra-low latency LPU inference with open weights (Llama 3, Mixtral).',
    docsUrl: 'https://console.groq.com/keys',
    color: '#f97316',
    letter: 'Q',
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    description: 'Unified model gateway with per-model pricing metadata; account access and rate limits may vary.',
    docsUrl: 'https://openrouter.ai/keys',
    color: '#8b5cf6',
    letter: 'R',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama Local',
    shortName: 'Ollama',
    description: '100% offline local model execution via local HTTP daemon (port 11434).',
    docsUrl: 'https://ollama.com',
    color: '#10b981',
    letter: 'O',
    baseUrl: 'http://localhost:11434/v1',
  },
  kimi: {
    id: 'kimi',
    name: 'Moonshot Kimi',
    shortName: 'Kimi',
    description: 'Long-context reasoning & coding models from Moonshot AI.',
    docsUrl: 'https://platform.moonshot.cn',
    color: '#06b6d4',
    letter: 'K',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    shortName: 'Qwen',
    description: 'Advanced open weights & cloud coding models (DashScope / Alibaba Cloud).',
    docsUrl: 'https://bailian.console.aliyun.com',
    color: '#6366f1',
    letter: 'W',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
}

export const PROVIDER_LIST: ProviderConfig[] = Object.values(PROVIDERS)
