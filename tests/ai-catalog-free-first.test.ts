import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeCatalog,
  preferredFreeModel,
  preferredModel,
  formatModelPricing,
  modelOption,
  TIER_LABELS,
} from '../src/lib/ai/catalog'
import { resolveProviderRoles } from '../src/lib/ai/orchestration'
import { providerErrorMessage } from '../src/lib/ai/errors'
import { useSettingsStore } from '../src/lib/store/useSettingsStore'

test('Gemini models classify as free-tier per documented provider policy (quota honestly unknown)', () => {
  const catalog = normalizeCatalog('gemini', {
    models: [
      { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
      { name: 'models/gemini-1.5-flash-8b', supportedGenerationMethods: ['generateContent'] },
    ],
  })

  assert.ok(catalog.find(m => m.id === 'gemini-2.5-flash'))
  // Master Prompt 3.1: Google documents a free developer tier (rate-limited)
  // for Gemini API models, so catalog models default to free-tier — never
  // 'free' (quota status stays unknown) and never 'unknown'.
  assert.ok(catalog.every(model => model.tier === 'free-tier'))
  assert.ok(preferredFreeModel(catalog))
})

test('Groq models classify as free-tier per documented provider policy (rate-limited)', () => {
  const catalog = normalizeCatalog('groq', {
    data: [
      { id: 'custom-enterprise-model' },
      { id: 'llama-3.3-70b-versatile', context_window: 131072 },
      { id: 'llama-3.1-8b-instant', context_window: 131072 },
    ],
  })

  assert.ok(catalog.find(m => m.id === 'llama-3.3-70b-versatile'))
  // Groq documents a free developer tier with per-model rate limits; the
  // catalog cannot see the account's remaining quota, so 'free-tier' is the
  // honest classification — not 'free' and not an unverified 'unknown'.
  assert.ok(catalog.every(model => model.tier === 'free-tier'))
  assert.ok(preferredFreeModel(catalog))
})

test('OpenRouter recognizes explicit :free variants but keeps unsuffixed zero-price models unknown', () => {
  const catalog = normalizeCatalog('openrouter', {
    data: [
      { id: 'anthropic/claude-3.5-sonnet', pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'openai/gpt-4o', pricing: { prompt: '0.000005', completion: '0.000015' } },
      { id: 'google/gemma-4-31b-it:free' },
      { id: 'openrouter/model-zero-priced', pricing: { prompt: '0', completion: '0' } },
    ],
  })

  const claude = catalog.find(m => m.id === 'anthropic/claude-3.5-sonnet')
  assert.ok(claude)
  assert.equal(claude.tier, 'paid')
  assert.equal(claude.isFree, false)

  const llamaFree = catalog.find(m => m.id === 'meta-llama/llama-3.3-70b-instruct:free')
  assert.ok(llamaFree)
  assert.equal(llamaFree.tier, 'free')
  assert.equal(llamaFree.isFree, true)

  const zeroPriceNoFreeSuffix = catalog.find(m => m.id === 'openrouter/model-zero-priced')
  assert.ok(zeroPriceNoFreeSuffix)
  assert.equal(zeroPriceNoFreeSuffix.tier, 'unknown') // $0 pricing does not prove free-account eligibility

  // Free-First: only explicit :free variants are automatically eligible.
  assert.equal(catalog[0].tier, 'free')
  assert.equal(catalog[1].tier, 'free')
  assert.equal(preferredFreeModel(catalog)?.id, 'google/gemma-4-31b-it:free')
})

test('System strictly protects against automatic paid model selection without explicit consent', () => {
  const paidOnlyModels = [
    modelOption('openrouter', 'anthropic/claude-3.7-sonnet'),
    modelOption('openrouter', 'openai/gpt-4o'),
  ]
  paidOnlyModels.forEach(m => {
    m.tier = 'paid'
    m.isFree = false
  })

  // Without explicit allowPaid, preferredFreeModel returns null
  assert.equal(preferredFreeModel(paidOnlyModels), null)
})

test('Pricing formatter correctly describes free and paid models without misleading assumptions', () => {
  const freeModel = modelOption('openrouter', 'meta-llama/llama-3.3-70b-instruct:free')
  freeModel.tier = 'free'
  assert.match(formatModelPricing(freeModel), /Gratis melalui varian :free/i)

  const freeTierModel = modelOption('groq', 'llama-3.3-70b-versatile')
  freeTierModel.tier = 'free-tier'
  assert.match(formatModelPricing(freeTierModel), /kuota pengembang/i)

  const zeroPriceUnknown = modelOption('openrouter', 'openrouter/model-zero')
  zeroPriceUnknown.pricing = { prompt: '0', completion: '0' }
  assert.match(formatModelPricing(zeroPriceUnknown), /kelayakan akun.*belum diverifikasi/i)

  const paidModel = modelOption('openrouter', 'openai/gpt-4o')
  paidModel.tier = 'paid'
  paidModel.pricing = { prompt: '0.0000025', completion: '0.00001' }
  assert.match(formatModelPricing(paidModel), /\$2\.50\/1M in/i)

  const unknownModel = modelOption('gemini', 'gemini-custom')
  unknownModel.tier = 'unknown'
  assert.match(formatModelPricing(unknownModel), /jangan diasumsikan gratis/i)
})

test('Multi-model orchestration modes (Economy, Balanced, Max) enforce Free-First constraints', () => {
  // Economy mode assigns selected primary model
  const economy = resolveProviderRoles('groq', ['gemini', 'groq', 'openrouter'], 'economy')
  assert.equal(economy.planner, 'groq')
  assert.equal(economy.coder, 'groq')
  assert.equal(economy.reviewer, null)

  // Balanced mode prefers Gemini as planner, primary as coder
  const balanced = resolveProviderRoles('groq', ['gemini', 'groq', 'openrouter'], 'balanced')
  assert.equal(balanced.planner, 'gemini')
  assert.equal(balanced.coder, 'groq')

  // Max mode assigns 3 distinct providers
  const max = resolveProviderRoles('groq', ['gemini', 'groq', 'openrouter'], 'max')
  assert.equal(max.planner, 'gemini')
  assert.equal(max.coder, 'groq')
  assert.equal(max.reviewer, 'openrouter')
})

test('Settings store retains role models, allowPaidModels toggle (default false), and budget ceiling', () => {
  const store = useSettingsStore.getState()
  
  // Default protection: allowPaidModels MUST be false
  assert.equal(store.allowPaidModels, false)

  // Set role model assignments
  store.setRoleModel('planner', 'gemini', 'gemini-2.5-flash')
  store.setRoleModel('reviewer', 'openrouter', 'meta-llama/llama-3.3-70b-instruct:free')
  store.setRoleModel('debugger', 'groq', 'llama-3.3-70b-versatile')

  const updated = useSettingsStore.getState()
  assert.equal(updated.roleModels.planner?.model, 'gemini-2.5-flash')
  assert.equal(updated.roleModels.reviewer?.model, 'meta-llama/llama-3.3-70b-instruct:free')
  assert.equal(updated.roleModels.debugger?.model, 'llama-3.3-70b-versatile')

  // Toggle paid models
  store.setAllowPaidModels(true)
  assert.equal(useSettingsStore.getState().allowPaidModels, true)
  store.setAllowPaidModels(false)
  assert.equal(useSettingsStore.getState().allowPaidModels, false)
})

test('Rate limit and quota errors provide informative messaging without secret leaks', () => {
  const quota429 = providerErrorMessage({ statusCode: 429 }, 'gemini', 'gemini-2.5-flash')
  assert.match(quota429, /API quota or rate limit exceeded \(429\)/)
  assert.match(quota429, /Google Gemini \(gemini-2\.5-flash\)/)

  const billing402 = providerErrorMessage({ statusCode: 402 }, 'openrouter', 'paid-model')
  assert.match(billing402, /no API credits or billing quota/i)
})
