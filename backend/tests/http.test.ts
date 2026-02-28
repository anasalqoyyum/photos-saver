import assert from 'node:assert/strict'
import test from 'node:test'

import { parseBearerToken } from '../src/http.ts'

test('parseBearerToken returns token for valid bearer header', () => {
  assert.equal(parseBearerToken('Bearer abc123'), 'abc123')
})

test('parseBearerToken rejects malformed headers', () => {
  assert.equal(parseBearerToken('Token abc123'), null)
  assert.equal(parseBearerToken('Bearer'), null)
  assert.equal(parseBearerToken(undefined), null)
})
