import crypto from 'node:crypto'

import {
  AuthStateRecord,
  ExchangeCodeRecord,
  SessionRecord,
  StoredGoogleTokens
} from './types.js'

export interface AuthStateStore {
  create(state: AuthStateRecord): void
  consume(state: string): AuthStateRecord | null
}

export interface ExchangeCodeStore {
  create(userId: string, ttlMs: number): ExchangeCodeRecord
  consume(code: string): ExchangeCodeRecord | null
}

export interface SessionStore {
  create(userId: string, ttlMs: number): SessionRecord
  get(token: string): SessionRecord | null
  revoke(token: string): void
}

export interface GoogleTokenStore {
  upsert(record: StoredGoogleTokens): void
  getByUserId(userId: string): StoredGoogleTokens | null
}

function now(): number {
  return Date.now()
}

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`
}

function isExpired(expiresAt: number): boolean {
  return now() >= expiresAt
}

export class InMemoryAuthStateStore implements AuthStateStore {
  private readonly records = new Map<string, AuthStateRecord>()

  create(state: AuthStateRecord): void {
    this.cleanup()
    this.records.set(state.state, state)
  }

  consume(state: string): AuthStateRecord | null {
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

  create(userId: string, ttlMs: number): ExchangeCodeRecord {
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

  consume(code: string): ExchangeCodeRecord | null {
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

  create(userId: string, ttlMs: number): SessionRecord {
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

  get(token: string): SessionRecord | null {
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

  revoke(token: string): void {
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

  upsert(record: StoredGoogleTokens): void {
    this.tokensByUser.set(record.userId, record)
  }

  getByUserId(userId: string): StoredGoogleTokens | null {
    return this.tokensByUser.get(userId) || null
  }
}
