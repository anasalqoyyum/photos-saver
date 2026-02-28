export interface KVNamespaceLike {
  get(key: string, type: 'text'): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: {
      expirationTtl?: number
    }
  ): Promise<void>
  delete(key: string): Promise<void>
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike
  exec(query: string): Promise<unknown>
}

export interface WorkerBindings {
  AUTH_KV?: KVNamespaceLike
  APP_DB?: D1DatabaseLike
}
