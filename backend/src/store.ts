import { bytesToBase64Url } from './base64.js'
import { TokenCipher } from './token-crypto.js'
import { AuthStateRecord, ExchangeCodeRecord, SessionRecord, StoredGoogleTokens } from './types.js'
import { D1DatabaseLike, KVNamespaceLike } from './worker-bindings.js'

export interface AuthStateStore {
  create(state: AuthStateRecord): Promise<void>
  consume(state: string): Promise<AuthStateRecord | null>
}

export interface ExchangeCodeStore {
  create(userId: string, ttlMs: number): Promise<ExchangeCodeRecord>
  consume(code: string): Promise<ExchangeCodeRecord | null>
}

export interface SessionStore {
  create(userId: string, ttlMs: number): Promise<SessionRecord>
  get(token: string): Promise<SessionRecord | null>
  revoke(token: string): Promise<void>
}

export interface GoogleTokenStore {
  upsert(record: StoredGoogleTokens): Promise<void>
  getByUserId(userId: string): Promise<StoredGoogleTokens | null>
}

function now(): number {
  return Date.now()
}

function randomToken(prefix: string): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(24))
  const payload = bytesToBase64Url(randomBytes)
  return `${prefix}_${payload}`
}

function isExpired(expiresAt: number): boolean {
  return now() >= expiresAt
}

function ttlSecondsFromMs(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export class InMemoryAuthStateStore implements AuthStateStore {
  private readonly records = new Map<string, AuthStateRecord>()

  async create(state: AuthStateRecord): Promise<void> {
    this.cleanup()
    this.records.set(state.state, state)
  }

  async consume(state: string): Promise<AuthStateRecord | null> {
    const record = this.records.get(state) || null
    if (!record) {
      return null
    }

    this.records.delete(state)
    if (isExpired(record.expiresAt)) {
      return null
    }

    return record
  }

  private cleanup(): void {
    for (const [key, record] of this.records.entries()) {
      if (isExpired(record.expiresAt)) {
        this.records.delete(key)
      }
    }
  }
}

export class InMemoryExchangeCodeStore implements ExchangeCodeStore {
  private readonly records = new Map<string, ExchangeCodeRecord>()

  async create(userId: string, ttlMs: number): Promise<ExchangeCodeRecord> {
    this.cleanup()

    const createdAt = now()
    const record: ExchangeCodeRecord = {
      code: randomToken('xchg'),
      userId,
      createdAt,
      expiresAt: createdAt + ttlMs
    }

    this.records.set(record.code, record)
    return record
  }

  async consume(code: string): Promise<ExchangeCodeRecord | null> {
    const record = this.records.get(code) || null
    if (!record) {
      return null
    }

    this.records.delete(code)
    if (isExpired(record.expiresAt)) {
      return null
    }

    return record
  }

  private cleanup(): void {
    for (const [key, record] of this.records.entries()) {
      if (isExpired(record.expiresAt)) {
        this.records.delete(key)
      }
    }
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>()

  async create(userId: string, ttlMs: number): Promise<SessionRecord> {
    this.cleanup()

    const createdAt = now()
    const record: SessionRecord = {
      token: randomToken('sess'),
      userId,
      createdAt,
      expiresAt: createdAt + ttlMs
    }

    this.sessions.set(record.token, record)
    return record
  }

  async get(token: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(token) || null
    if (!session) {
      return null
    }

    if (isExpired(session.expiresAt)) {
      this.sessions.delete(token)
      return null
    }

    return session
  }

  async revoke(token: string): Promise<void> {
    this.sessions.delete(token)
  }

  private cleanup(): void {
    for (const [token, session] of this.sessions.entries()) {
      if (isExpired(session.expiresAt)) {
        this.sessions.delete(token)
      }
    }
  }
}

export class InMemoryGoogleTokenStore implements GoogleTokenStore {
  private readonly tokensByUser = new Map<string, StoredGoogleTokens>()

  async upsert(record: StoredGoogleTokens): Promise<void> {
    this.tokensByUser.set(record.userId, record)
  }

  async getByUserId(userId: string): Promise<StoredGoogleTokens | null> {
    return this.tokensByUser.get(userId) || null
  }
}

export class CloudflareKVAuthStateStore implements AuthStateStore {
  constructor(private readonly kv: KVNamespaceLike) {}

  async create(state: AuthStateRecord): Promise<void> {
    const ttlSeconds = ttlSecondsFromMs(state.expiresAt - now())
    await this.kv.put(`auth_state:${state.state}`, JSON.stringify(state), {
      expirationTtl: ttlSeconds
    })
  }

  async consume(state: string): Promise<AuthStateRecord | null> {
    const key = `auth_state:${state}`
    const raw = await this.kv.get(key, 'text')
    await this.kv.delete(key)

    const record = safeParseJson<AuthStateRecord>(raw)
    if (!record || isExpired(record.expiresAt)) {
      return null
    }

    return record
  }
}

export class CloudflareKVExchangeCodeStore implements ExchangeCodeStore {
  constructor(private readonly kv: KVNamespaceLike) {}

  async create(userId: string, ttlMs: number): Promise<ExchangeCodeRecord> {
    const createdAt = now()
    const record: ExchangeCodeRecord = {
      code: randomToken('xchg'),
      userId,
      createdAt,
      expiresAt: createdAt + ttlMs
    }

    await this.kv.put(`exchange_code:${record.code}`, JSON.stringify(record), {
      expirationTtl: ttlSecondsFromMs(ttlMs)
    })

    return record
  }

  async consume(code: string): Promise<ExchangeCodeRecord | null> {
    const key = `exchange_code:${code}`
    const raw = await this.kv.get(key, 'text')
    await this.kv.delete(key)

    const record = safeParseJson<ExchangeCodeRecord>(raw)
    if (!record || isExpired(record.expiresAt)) {
      return null
    }

    return record
  }
}

interface D1AuthStateRow {
  state: string
  extension_redirect_uri: string
  created_at: number
  expires_at: number
}

export class D1AuthStateStore implements AuthStateStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(state: AuthStateRecord): Promise<void> {
    await this.db.prepare('DELETE FROM auth_states WHERE expires_at <= ?1').bind(now()).run()

    await this.db
      .prepare(
        `INSERT INTO auth_states (state, extension_redirect_uri, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(state.state, state.extensionRedirectUri, state.createdAt, state.expiresAt)
      .run()
  }

  async consume(state: string): Promise<AuthStateRecord | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM auth_states
         WHERE state = ?1
         RETURNING state, extension_redirect_uri, created_at, expires_at`
      )
      .bind(state)
      .first<D1AuthStateRow>()

    if (!row || isExpired(row.expires_at)) {
      return null
    }

    return {
      state: row.state,
      extensionRedirectUri: row.extension_redirect_uri,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }
  }
}

interface D1ExchangeCodeRow {
  code: string
  user_id: string
  created_at: number
  expires_at: number
}

export class D1ExchangeCodeStore implements ExchangeCodeStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(userId: string, ttlMs: number): Promise<ExchangeCodeRecord> {
    await this.db.prepare('DELETE FROM exchange_codes WHERE expires_at <= ?1').bind(now()).run()

    const createdAt = now()
    const record: ExchangeCodeRecord = {
      code: randomToken('xchg'),
      userId,
      createdAt,
      expiresAt: createdAt + ttlMs
    }

    await this.db
      .prepare(
        `INSERT INTO exchange_codes (code, user_id, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(record.code, record.userId, record.createdAt, record.expiresAt)
      .run()

    return record
  }

  async consume(code: string): Promise<ExchangeCodeRecord | null> {
    const row = await this.db
      .prepare(
        `DELETE FROM exchange_codes
         WHERE code = ?1
         RETURNING code, user_id, created_at, expires_at`
      )
      .bind(code)
      .first<D1ExchangeCodeRow>()

    if (!row || isExpired(row.expires_at)) {
      return null
    }

    return {
      code: row.code,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    }
  }
}

export class CloudflareKVSessionStore implements SessionStore {
  constructor(private readonly kv: KVNamespaceLike) {}

  async create(userId: string, ttlMs: number): Promise<SessionRecord> {
    const createdAt = now()
    const record: SessionRecord = {
      token: randomToken('sess'),
      userId,
      createdAt,
      expiresAt: createdAt + ttlMs
    }

    await this.kv.put(`session:${record.token}`, JSON.stringify(record), {
      expirationTtl: ttlSecondsFromMs(ttlMs)
    })

    return record
  }

  async get(token: string): Promise<SessionRecord | null> {
    const key = `session:${token}`
    const raw = await this.kv.get(key, 'text')
    const record = safeParseJson<SessionRecord>(raw)

    if (!record || isExpired(record.expiresAt)) {
      await this.kv.delete(key)
      return null
    }

    return record
  }

  async revoke(token: string): Promise<void> {
    await this.kv.delete(`session:${token}`)
  }
}

interface D1GoogleTokenRow {
  user_id: string
  encrypted_refresh_token: string
  scope: string | null
  updated_at: number
}

export class D1GoogleTokenStore implements GoogleTokenStore {
  constructor(
    private readonly db: D1DatabaseLike,
    private readonly cipher: TokenCipher
  ) {}

  async upsert(record: StoredGoogleTokens): Promise<void> {
    const encryptedRefreshToken = await this.cipher.encrypt(record.refreshToken)

    await this.db
      .prepare(
        `INSERT INTO google_tokens (user_id, encrypted_refresh_token, scope, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id) DO UPDATE SET
           encrypted_refresh_token = excluded.encrypted_refresh_token,
           scope = excluded.scope,
           updated_at = excluded.updated_at`
      )
      .bind(record.userId, encryptedRefreshToken, record.scope || null, record.updatedAt)
      .run()
  }

  async getByUserId(userId: string): Promise<StoredGoogleTokens | null> {
    const row = await this.db
      .prepare(
        `SELECT user_id, encrypted_refresh_token, scope, updated_at
         FROM google_tokens
         WHERE user_id = ?1`
      )
      .bind(userId)
      .first<D1GoogleTokenRow>()

    if (!row) {
      return null
    }

    const refreshToken = await this.cipher.decrypt(row.encrypted_refresh_token)

    if (row.scope) {
      return {
        userId: row.user_id,
        refreshToken,
        scope: row.scope,
        updatedAt: row.updated_at
      }
    }

    return {
      userId: row.user_id,
      refreshToken,
      updatedAt: row.updated_at
    }
  }
}
