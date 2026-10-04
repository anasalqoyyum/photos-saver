import { afterEach, describe, expect, it, vi } from 'vitest'

import { CloudflareKVSessionStore } from '../src/store.js'

function createKv() {
  const records = new Map<string, string>()
  const kv = {
    get: vi.fn(async (key: string, _type: 'text') => records.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _options?: { expirationTtl?: number }) => {
      records.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      records.delete(key)
    })
  }
  return { records, kv, store: new CloudflareKVSessionStore(kv) }
}

describe('CloudflareKVSessionStore', () => {
  afterEach(() => vi.useRealTimers())

  it('does not delete a valid session after a stale miss', async () => {
    const { records, kv, store } = createKv()
    const session = await store.create('user-123', 2_592_000_000)
    kv.get.mockResolvedValueOnce(null)
    expect(await store.get(session.token)).toBeNull()
    expect(kv.delete).not.toHaveBeenCalled()
    expect(records.has(`session:${session.token}`)).toBe(true)
    expect(await store.get(session.token)).toEqual(session)
    expect(kv.put).toHaveBeenCalledWith(`session:${session.token}`, JSON.stringify(session), { expirationTtl: 2_592_000 })
  })

  it('rejects expired records without deleting on a read', async () => {
    vi.useFakeTimers()
    const { kv, store } = createKv()
    const session = await store.create('user-123', 60_000)
    vi.setSystemTime(session.expiresAt)
    expect(await store.get(session.token)).toBeNull()
    expect(kv.delete).not.toHaveBeenCalled()
  })

  it('rejects malformed records without deleting on a read', async () => {
    const { kv, store } = createKv()
    kv.get.mockResolvedValueOnce('invalid json')
    expect(await store.get('session-token')).toBeNull()
    expect(kv.delete).not.toHaveBeenCalled()
  })

  it('still deletes explicitly revoked sessions', async () => {
    const { kv, store } = createKv()
    const session = await store.create('user-123', 60_000)
    await store.revoke(session.token)
    expect(kv.delete).toHaveBeenCalledWith(`session:${session.token}`)
    expect(await store.get(session.token)).toBeNull()
  })
})
