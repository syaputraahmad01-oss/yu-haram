/**
 * Regression tests for the simplified model picker display names.
 *
 * Model ids arrive from provider catalogs as "google/gemini-2.0-flash-exp:free"
 * or "models/gemini-1.5-pro". shortModelName strips vendor prefixes and the
 * free-variant suffix so the picker stays compact and scannable, while the
 * full id remains available in the title tooltip and the store.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { shortModelName, modelLabel } from '../src/lib/ai/catalog'

test('shortModelName strips the OpenRouter vendor prefix and :free suffix', () => {
  assert.equal(shortModelName('google/gemini-2.0-flash-exp:free'), 'gemini-2.0-flash-exp')
})

test('shortModelName strips a vendor prefix without :free', () => {
  assert.equal(shortModelName('meta-llama/llama-3.1-8b-instruct'), 'llama-3.1-8b-instruct')
})

test('shortModelName strips only the last path segment (Gemini "models/" style)', () => {
  assert.equal(shortModelName('models/gemini-1.5-pro'), 'gemini-1.5-pro')
})

test('shortModelName keeps ids without a prefix untouched', () => {
  assert.equal(shortModelName('llama-3.1-8b-instant'), 'llama-3.1-8b-instant')
  assert.equal(shortModelName('moonshot-v1-8k'), 'moonshot-v1-8k')
})

test('shortModelName removes a lone :free suffix', () => {
  assert.equal(shortModelName('deepseek-chat:free'), 'deepseek-chat')
})

test('shortModelName never returns an empty string', () => {
  assert.equal(shortModelName('/'), '/')
  assert.equal(shortModelName(':free'), ':free')
})

test('modelLabel keeps its long-form format for verbose contexts', () => {
  const label = modelLabel({ id: 'x:free', name: 'x:free', provider: 'openrouter', tier: 'free' })
  assert.ok(label.includes('[GRATIS]'))
})
