import { describe, expect, it } from 'vitest'

import { isValidExtensionRedirectUri } from '../src/extension-redirect-uri.js'

describe('isValidExtensionRedirectUri', () => {
  it('accepts chromium and firefox redirect hosts', () => {
    expect(isValidExtensionRedirectUri('https://abc123.chromiumapp.org/')).toBe(true)
    expect(isValidExtensionRedirectUri('https://save-to-google-photos.example.extensions.allizom.org/')).toBe(true)
    expect(isValidExtensionRedirectUri('https://save-to-google-photos.example.extensions.mozilla.org/')).toBe(true)
  })

  it('rejects invalid protocols and hosts', () => {
    expect(isValidExtensionRedirectUri('http://abc123.chromiumapp.org/')).toBe(false)
    expect(isValidExtensionRedirectUri('https://example.com/callback')).toBe(false)
    expect(isValidExtensionRedirectUri('not-a-url')).toBe(false)
  })
})
