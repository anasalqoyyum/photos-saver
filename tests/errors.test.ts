import assert from 'node:assert/strict'
import test from 'node:test'

import { ExtensionError, normalizeError, toUserMessage } from '../src/errors.ts'

test('normalizeError passes through ExtensionError', () => {
  const input = new ExtensionError('FETCH_FAILED', 'boom')
  assert.equal(normalizeError(input), input)
})

test('normalizeError wraps unknown values', () => {
  const err = normalizeError('nope')
  assert.equal(err.code, 'UNKNOWN')
})

test('toUserMessage maps auth errors', () => {
  const msg = toUserMessage(new ExtensionError('AUTH_FAILED', 'x'))
  assert.equal(msg, 'Google sign-in failed. Please try again.')
})
