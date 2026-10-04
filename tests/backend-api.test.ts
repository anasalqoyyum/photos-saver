import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadConfig } from '../backend/src/config.ts'
import { handleAuthRefresh } from '../backend/src/routes/auth.ts'
import { InMemoryAuthStateStore, InMemoryExchangeCodeStore, InMemoryGoogleTokenStore, InMemorySessionStore } from '../backend/src/store.ts'
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

function installChromeMock(
  initialSession: StoredSession | null,
  failures: { get?: boolean; set?: boolean; remove?: boolean } = {}
): Map<string, unknown> {
  const storage = new Map<string, unknown>(initialSession ? [['backendSession', initialSession]] : [])
  const runtime: { lastError: { message: string } | undefined } = { lastError: undefined }

  function fail(operation: keyof typeof failures, callback: () => void): boolean {
    if (!failures[operation]) return false
    runtime.lastError = { message: `Storage ${operation} failed` }
    callback()
    runtime.lastError = undefined
    return true
  }

  vi.stubGlobal('chrome', {
    runtime,
    storage: {
      local: {
        get(key: string, callback: (values: Record<string, unknown>) => void) {
          if (fail('get', () => callback({}))) return
          callback({ [key]: storage.get(key) })
        },
        set(values: Record<string, unknown>, callback: () => void) {
          if (fail('set', callback)) return
          for (const [key, value] of Object.entries(values)) {
            storage.set(key, value)
          }
          callback()
        },
        remove(key: string, callback: () => void) {
          if (fail('remove', callback)) return
          storage.delete(key)
          callback()
        }
      }
    },
    identity: {
      getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
      launchWebAuthFlow: vi.fn((_options: unknown, callback: (redirect: string) => void) => {
        callback('https://extension-id.chromiumapp.org/?session_code=test-code')
      })
    }
  })

  return storage
}

async function installBackend(sessionTtlMs = 6 * DAY_MS) {
  const sessionStore = new InMemorySessionStore()
  const session = await sessionStore.create('user-123', sessionTtlMs)
  const failures = { get: false, set: false, remove: false }
  const storage = installChromeMock({ token: session.token, expiresAt: session.expiresAt }, failures)
  const options = {
    config: loadConfig({
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/callback',
      SESSION_TTL_MS: String(30 * DAY_MS)
    }),
    sessionStore,
    authStateStore: new InMemoryAuthStateStore(),
    exchangeCodeStore: new InMemoryExchangeCodeStore(),
    googleTokenStore: new InMemoryGoogleTokenStore()
  }
  const transport = { loseRefreshResponse: false }
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === '/v1/auth/refresh') {
      const response = await handleAuthRefresh(request, options)
      if (response.ok && transport.loseRefreshResponse) throw new TypeError('Lost refresh response')
      return response
    }
    if (path === '/v1/auth/start') return Response.json({ authUrl: 'https://example.com/oauth' })
    if (path === '/v1/auth/exchange') {
      const replacement = await sessionStore.create('user-123', options.config.sessionTtlMs)
      return Response.json({ sessionToken: replacement.token, expiresAt: replacement.expiresAt })
    }
    expect(path).toBe('/v1/photos/upload')
    const token = request.headers.get('authorization')?.slice(7) || ''
    return new Response(null, { status: (await sessionStore.get(token)) ? 200 : 401 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { session, sessionStore, storage, failures, fetchMock, transport }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('backend session renewal', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
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

  it('recovers after a committed refresh response is lost, including after restart', async () => {
    const backend = await installBackend()
    backend.transport.loseRefreshResponse = true
    const firstWorker = await import('../src/backend-api.ts')
    await firstWorker.uploadImageViaBackend(createImage())

    expect(await backend.sessionStore.get(backend.session.token)).toEqual(backend.session)
    expect(backend.storage.get('backendSession')).toMatchObject({ token: backend.session.token })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()

    backend.transport.loseRefreshResponse = false
    vi.resetModules()
    const restartedWorker = await import('../src/backend-api.ts')
    await restartedWorker.uploadImageViaBackend(createImage())
    expect(backend.storage.get('backendSession')).not.toMatchObject({ token: backend.session.token })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it.each([false, true])('reports failed persistence and retries without OAuth, restart=%s', async restart => {
    const backend = await installBackend()
    backend.failures.set = true
    let worker = await import('../src/backend-api.ts')
    await expect(worker.uploadImageViaBackend(createImage())).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(backend.fetchMock).toHaveBeenCalledTimes(1)
    expect(backend.storage.get('backendSession')).toMatchObject({ token: backend.session.token })
    expect(await backend.sessionStore.get(backend.session.token)).toEqual(backend.session)

    backend.failures.set = false
    if (restart) {
      vi.resetModules()
      worker = await import('../src/backend-api.ts')
    }
    await worker.uploadImageViaBackend(createImage())
    expect(backend.storage.get('backendSession')).not.toMatchObject({ token: backend.session.token })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
  })

  it('does not upload or expose a renewed session until persistence finishes', async () => {
    const backend = await installBackend()
    const writeStarted = deferred<void>()
    const writeFinished = deferred<void>()
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local)
    vi.spyOn(chrome.storage.local, 'set').mockImplementation((values, callback) => {
      writeStarted.resolve()
      void writeFinished.promise.then(() => originalSet(values, callback))
    })
    const worker = await import('../src/backend-api.ts')
    const firstUpload = worker.uploadImageViaBackend(createImage())
    await writeStarted.promise
    const secondUpload = worker.uploadImageViaBackend(createImage())
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(backend.fetchMock).toHaveBeenCalledTimes(1)
    writeFinished.resolve()
    await Promise.all([firstUpload, secondUpload])
    expect(backend.fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each(['get', 'remove'] as const)('reports storage %s failure before OAuth and allows retry', async operation => {
    const backend = await installBackend()
    if (operation === 'remove') await backend.sessionStore.revoke(backend.session.token)
    backend.failures[operation] = true
    const worker = await import('../src/backend-api.ts')
    await expect(worker.uploadImageViaBackend(createImage())).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()

    backend.failures[operation] = false
    await worker.uploadImageViaBackend(createImage())
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(operation === 'remove' ? 1 : 0)
  })

  it('does not retain an OAuth session in memory when its storage write fails', async () => {
    const backend = await installBackend()
    await backend.sessionStore.revoke(backend.session.token)
    backend.failures.set = true
    const worker = await import('../src/backend-api.ts')
    await expect(worker.uploadImageViaBackend(createImage())).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(backend.storage.has('backendSession')).toBe(false)
    backend.failures.set = false
    await worker.uploadImageViaBackend(createImage())
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('preserves a newer session after a delayed old upload rejection, refresh pending=%s', async refreshPending => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const backend = await installBackend(7 * DAY_MS + 1000)
    const oldUploadStarted = deferred<void>()
    const oldUploadResponse = deferred<Response>()
    const refreshStarted = deferred<void>()
    const refreshResponse = deferred<void>()
    const serve = backend.fetchMock.getMockImplementation()!
    backend.fetchMock.mockImplementation(async (input, init) => {
      if (
        getRequestUrl(input).endsWith('/v1/photos/upload') &&
        new Headers(init?.headers).get('authorization') === `Bearer ${backend.session.token}`
      ) {
        oldUploadStarted.resolve()
        return oldUploadResponse.promise
      }
      const response = await serve(input, init)
      if (getRequestUrl(input).endsWith('/v1/auth/refresh') && refreshPending) {
        refreshStarted.resolve()
        return refreshResponse.promise.then(() => response)
      }
      return response
    })
    const worker = await import('../src/backend-api.ts')
    const firstUpload = worker.uploadImageViaBackend(createImage())
    await oldUploadStarted.promise
    vi.setSystemTime(Date.now() + 2000)
    const secondUpload = worker.uploadImageViaBackend(createImage())
    if (refreshPending) await refreshStarted.promise
    else await secondUpload
    oldUploadResponse.resolve(new Response(null, { status: 401 }))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
    refreshResponse.resolve()
    await Promise.all([firstUpload, secondUpload])
    expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled()
    expect(backend.storage.get('backendSession')).not.toMatchObject({ token: backend.session.token })
    expect(backend.fetchMock).toHaveBeenCalledTimes(4)
  })

  it('shares one OAuth recovery across concurrent rejected uploads', async () => {
    const backend = await installBackend(8 * DAY_MS)
    await backend.sessionStore.revoke(backend.session.token)
    const worker = await import('../src/backend-api.ts')
    await Promise.all([worker.uploadImageViaBackend(createImage()), worker.uploadImageViaBackend(createImage())])
    expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1)
    expect(backend.storage.get('backendSession')).not.toMatchObject({ token: backend.session.token })
  })
})
