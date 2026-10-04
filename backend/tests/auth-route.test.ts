import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadConfig } from '../src/config.js'
import { handleAuthLogout, handleAuthRefresh, type AuthRoutesOptions } from '../src/routes/auth.js'
import {
  CloudflareKVSessionStore,
  InMemoryAuthStateStore,
  InMemoryExchangeCodeStore,
  InMemoryGoogleTokenStore,
  InMemorySessionStore
} from '../src/store.js'

const DAY_MS = 86_400_000

function createOptions(useKv: boolean): AuthRoutesOptions {
  const records = new Map<string, string>()
  const sessionStore = useKv
    ? new CloudflareKVSessionStore({
        get: async key => records.get(key) ?? null,
        put: async (key, value) => {
          records.set(key, value)
        },
        delete: async key => {
          records.delete(key)
        }
      })
    : new InMemorySessionStore()
  return {
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
}

function refreshRequest(token?: string): Request {
  return new Request('https://example.com/v1/auth/refresh', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {}
  })
}

describe.each([false, true])('session renewal, KV=%s', useKv => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('issues a full-TTL replacement while preserving the original expiry for recovery', async () => {
    vi.useFakeTimers()
    const options = createOptions(useKv)
    const oldSession = await options.sessionStore.create('user-123', 6 * DAY_MS)
    const response = await handleAuthRefresh(refreshRequest(oldSession.token), options)
    expect(response.status).toBe(200)
    const replacement = (await response.json()) as { sessionToken: string; expiresAt: number }
    expect(replacement.sessionToken).not.toBe(oldSession.token)
    expect(replacement.expiresAt).toBe(Date.now() + 30 * DAY_MS)
    expect(await options.sessionStore.get(replacement.sessionToken)).toMatchObject({ userId: oldSession.userId })
    expect(await options.sessionStore.get(oldSession.token)).toEqual(oldSession)

    const retried = await handleAuthRefresh(refreshRequest(oldSession.token), options)
    expect(retried.status).toBe(200)
    expect(await options.sessionStore.get(oldSession.token)).toEqual(oldSession)
    vi.setSystemTime(oldSession.expiresAt)
    expect((await handleAuthRefresh(refreshRequest(oldSession.token), options)).status).toBe(401)
    expect(await options.sessionStore.get(replacement.sessionToken)).not.toBeNull()
  })

  it('preserves the old session if creating its replacement fails', async () => {
    const options = createOptions(useKv)
    const oldSession = await options.sessionStore.create('user-123', 6 * DAY_MS)
    vi.spyOn(options.sessionStore, 'create').mockRejectedValueOnce(new Error('Write failed'))
    await expect(handleAuthRefresh(refreshRequest(oldSession.token), options)).rejects.toThrow('Write failed')
    expect(await options.sessionStore.get(oldSession.token)).toEqual(oldSession)
  })

  it('rejects missing, unknown, and explicitly revoked tokens', async () => {
    const options = createOptions(useKv)
    expect((await handleAuthRefresh(refreshRequest(), options)).status).toBe(401)
    expect((await handleAuthRefresh(refreshRequest('unknown-token'), options)).status).toBe(401)
    const session = await options.sessionStore.create('user-123', 6 * DAY_MS)
    expect((await handleAuthLogout(refreshRequest(session.token), options)).status).toBe(204)
    expect((await handleAuthRefresh(refreshRequest(session.token), options)).status).toBe(401)
  })
})
