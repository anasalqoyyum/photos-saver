import assert from 'node:assert/strict'
import test from 'node:test'

import { isFirefoxRedirectUri } from '../src/oauth-web-flow.ts'

test('isFirefoxRedirectUri detects Firefox extension redirect domains', () => {
  assert.equal(isFirefoxRedirectUri('https://save-to-google-photos.example.extensions.mozilla.org/'), true)
  assert.equal(isFirefoxRedirectUri('https://save-to-google-photos.example.extensions.allizom.org/'), true)
})

test('isFirefoxRedirectUri rejects chromium and non-extension URLs', () => {
  assert.equal(isFirefoxRedirectUri('https://abc123.chromiumapp.org/'), false)
  assert.equal(isFirefoxRedirectUri('https://example.com/callback'), false)
  assert.equal(isFirefoxRedirectUri('not-a-url'), false)
})
