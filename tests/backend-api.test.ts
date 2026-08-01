import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FetchedImage } from '../src/image-fetch.ts'

const DAY_MS = 24 * 60 * 60 * 1000

interface StoredSession {
  token: string
  expiresAt: number
}

function createImage(): FetchedImage {
  return {
    bytes: new Uint8Array([1, 2, 3]).buffer,
    contentType: 'image/png',
    fileName: 'photo.png',
    sourceUrl: 'https://example.com/photo.png'
  }
}

function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input
  }

  return input instanceof URL ? input.href : input.url
}

function installChromeMock(initialSession: StoredSession): Map<string, unknown> {
  const storage = new Map<string, unknown>([['backendSession', initialSession]])

  vi.stubGlobal('chrome', {
    runtime: {
      lastError: undefined
    },
    storage: {
      local: {
        get(key: string, callback: (values: Record<string, unknown>) => void) {
          callback({ [key]: storage.get(key) })
        },
        set(values: Record<string, unknown>, callback: () => void) {
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value)
          }
          callback()
        },
        remove(key: string, callback: () => void) {
          storage.delete(key)
          callback()
        }
      }
    },
    identity: {
      getRedirectURL: () => 'https://extension-id.chromiumapp.org/'
    }
  })

  return storage
}

describe('backend session renewal', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('reuses a session with more than seven days remaining', async () => {
    const session = {
      token: 'existing-token',
      expiresAt: Date.now() + 8 * DAY_MS
    }
    installChromeMock(session)

    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { uploadImageViaBackend } = await import('../src/backend-api.ts')
    await uploadImageViaBackend(createImage())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://photos-saver.anasalqoyyum.dev/v1/photos/upload')
  })

  it('renews and persists a session with seven days or less remaining', async () => {
    const session = {
      token: 'existing-token',
      expiresAt: Date.now() + 6 * DAY_MS
    }
    const storage = installChromeMock(session)
    const renewedSession = {
      sessionToken: 'renewed-token',
      expiresAt: Date.now() + 30 * DAY_MS
    }

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (getRequestUrl(input).endsWith('/v1/auth/refresh')) {
        return Response.json(renewedSession)
      }

      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { uploadImageViaBackend } = await import('../src/backend-api.ts')
    await uploadImageViaBackend(createImage())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storage.get('backendSession')).toEqual({
      token: renewedSession.sessionToken,
      expiresAt: renewedSession.expiresAt
    })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer renewed-token'
      }
    })
  })

  it('uses the existing valid session when renewal temporarily fails', async () => {
    const session = {
      token: 'existing-token',
      expiresAt: Date.now() + 6 * DAY_MS
    }
    installChromeMock(session)

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (getRequestUrl(input).endsWith('/v1/auth/refresh')) {
        return new Response(null, { status: 503 })
      }

      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { uploadImageViaBackend } = await import('../src/backend-api.ts')
    await uploadImageViaBackend(createImage())

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer existing-token'
      }
    })
  })

  it('shares one renewal request across concurrent uploads', async () => {
    const session = {
      token: 'existing-token',
      expiresAt: Date.now() + 6 * DAY_MS
    }
    installChromeMock(session)
    let refreshRequests = 0

    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (getRequestUrl(input).endsWith('/v1/auth/refresh')) {
        refreshRequests += 1
        await Promise.resolve()
        return Response.json({
          sessionToken: 'renewed-token',
          expiresAt: Date.now() + 30 * DAY_MS
        })
      }

      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { uploadImageViaBackend } = await import('../src/backend-api.ts')
    await Promise.all([uploadImageViaBackend(createImage()), uploadImageViaBackend(createImage())])

    expect(refreshRequests).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
