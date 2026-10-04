import { describe, expect, it } from 'vitest'

import { isFirefoxRedirectUri } from '../src/oauth-web-flow.ts'

describe('isFirefoxRedirectUri', () => {
  it('detects Firefox extension redirect domains', () => {
    expect(isFirefoxRedirectUri('https://save-to-google-photos.example.extensions.mozilla.org/')).toBe(true)
    expect(isFirefoxRedirectUri('https://save-to-google-photos.example.extensions.allizom.org/')).toBe(true)
  })

  it('rejects chromium and non-extension URLs', () => {
    expect(isFirefoxRedirectUri('https://abc123.chromiumapp.org/')).toBe(false)
    expect(isFirefoxRedirectUri('https://example.com/callback')).toBe(false)
    expect(isFirefoxRedirectUri('not-a-url')).toBe(false)
  })
})
