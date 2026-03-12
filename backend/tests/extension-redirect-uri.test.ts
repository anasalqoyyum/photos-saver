import assert from 'node:assert/strict'
import test from 'node:test'

import { isValidExtensionRedirectUri } from '../src/extension-redirect-uri.js'

test('isValidExtensionRedirectUri accepts chromium and firefox redirect hosts', () => {
  assert.equal(
    isValidExtensionRedirectUri('https://abc123.chromiumapp.org/'),
    true
  )
  assert.equal(
    isValidExtensionRedirectUri('https://save-to-google-photos.example.extensions.allizom.org/'),
    true
  )
  assert.equal(
    isValidExtensionRedirectUri('https://save-to-google-photos.example.extensions.mozilla.org/'),
    true
  )
})

test('isValidExtensionRedirectUri rejects invalid protocols and hosts', () => {
  assert.equal(
    isValidExtensionRedirectUri('http://abc123.chromiumapp.org/'),
    false
  )
  assert.equal(
    isValidExtensionRedirectUri('https://example.com/callback'),
    false
  )
  assert.equal(isValidExtensionRedirectUri('not-a-url'), false)
})
