import { describe, expect, it } from 'vitest'

import { parseBearerToken } from '../src/http.js'

describe('parseBearerToken', () => {
  it('returns token for valid bearer header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123')
  })

  it('rejects malformed headers', () => {
    expect(parseBearerToken('Token abc123')).toBe(null)
    expect(parseBearerToken('Bearer')).toBe(null)
    expect(parseBearerToken(undefined)).toBe(null)
  })
})
