import { describe, expect, it } from 'vitest'

import { ExtensionError, normalizeError, toUserMessage } from '../src/errors.ts'

describe('normalizeError', () => {
  it('passes through ExtensionError', () => {
    const input = new ExtensionError('FETCH_FAILED', 'boom')
    expect(normalizeError(input)).toBe(input)
  })

  it('wraps unknown values', () => {
    const err = normalizeError('nope')
    expect(err.code).toBe('UNKNOWN')
  })
})

describe('toUserMessage', () => {
  it('maps auth errors', () => {
    const msg = toUserMessage(new ExtensionError('AUTH_FAILED', 'x'))
    expect(msg).toBe('Google sign-in failed. Please try again.')
  })

  it('explains session storage failures', () => {
    expect(toUserMessage(new ExtensionError('STORAGE_FAILED', 'x'))).toBe('Could not save or read your sign-in session. Please try again.')
  })
})
