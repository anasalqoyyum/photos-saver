import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../src/config.js'
import { handlePhotoUpload, type PhotosRoutesOptions } from '../src/routes/photos.js'

function createConfig(): AppConfig {
  return {
    googleClientId: 'client-id',
    googleClientSecret: 'client-secret',
    googleOauthRedirectUri: 'https://example.com/oauth/callback',
    googleScopes: ['https://www.googleapis.com/auth/photoslibrary.appendonly'],
    googleOauthForceConsent: false,
    sessionTtlMs: 60_000,
    authStateTtlMs: 60_000,
    exchangeCodeTtlMs: 60_000,
    maxUploadBytes: 10_000
  }
}

function createOptions(): PhotosRoutesOptions {
  return {
    config: createConfig(),
    sessionStore: {
      create: async () => {
        throw new Error('not implemented')
      },
      get: async token => ({
        token,
        userId: 'user-123',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000
      }),
      revoke: async () => {}
    },
    googleTokenStore: {
      upsert: async () => {},
      getByUserId: async () => null
    }
  }
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json()) as { error?: string }
  return payload.error || ''
}

describe('handlePhotoUpload', () => {
  it('accepts missing pageUrl field', async () => {
    const request = new Request('https://example.com/v1/photos/upload', {
      method: 'POST',
      headers: {
        authorization: 'Bearer session-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        imageBase64: 'AQ==',
        fileName: 'image.jpg',
        sourceUrl: 'https://images.example.com/photo.jpg',
        contentType: 'image/jpeg'
      })
    })

    const response = await handlePhotoUpload(request, createOptions())

    expect(response.status).toBe(401)
    expect(await readError(response)).toBe('USER_NOT_LINKED_TO_GOOGLE')
  })

  it('rejects non-string pageUrl', async () => {
    const request = new Request('https://example.com/v1/photos/upload', {
      method: 'POST',
      headers: {
        authorization: 'Bearer session-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        imageBase64: 'AQ==',
        fileName: 'image.jpg',
        sourceUrl: 'https://images.example.com/photo.jpg',
        contentType: 'image/jpeg',
        pageUrl: 123
      })
    })

    const response = await handlePhotoUpload(request, createOptions())

    expect(response.status).toBe(400)
    expect(await readError(response)).toBe('INVALID_UPLOAD_BODY')
  })
})
