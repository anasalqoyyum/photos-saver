import { AppConfig } from './config.js'
import {
  AuthStateStore,
  CloudflareKVSessionStore,
  D1AuthStateStore,
  D1ExchangeCodeStore,
  D1GoogleTokenStore,
  ExchangeCodeStore,
  GoogleTokenStore,
  InMemoryAuthStateStore,
  InMemoryExchangeCodeStore,
  InMemoryGoogleTokenStore,
  InMemorySessionStore,
  SessionStore
} from './store.js'
import { TokenCipher } from './token-crypto.js'
import { WorkerBindings } from './worker-bindings.js'

export interface AppStores {
  authStateStore: AuthStateStore
  exchangeCodeStore: ExchangeCodeStore
  sessionStore: SessionStore
  googleTokenStore: GoogleTokenStore
}

function hasCloudflareBindings(
  bindings?: WorkerBindings
): bindings is WorkerBindings & {
  AUTH_KV: NonNullable<WorkerBindings['AUTH_KV']>
  APP_DB: NonNullable<WorkerBindings['APP_DB']>
} {
  return Boolean(bindings?.AUTH_KV && bindings.APP_DB)
}

function createInMemoryStores(): AppStores {
  return {
    authStateStore: new InMemoryAuthStateStore(),
    exchangeCodeStore: new InMemoryExchangeCodeStore(),
    sessionStore: new InMemorySessionStore(),
    googleTokenStore: new InMemoryGoogleTokenStore()
  }
}

export async function createStoresForRuntime(
  config: AppConfig,
  bindings?: WorkerBindings
): Promise<AppStores> {
  if (!hasCloudflareBindings(bindings)) {
    return createInMemoryStores()
  }

  if (!config.tokenEncryptionKey) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is required when AUTH_KV and APP_DB bindings are configured.'
    )
  }

  const cipher = await TokenCipher.fromSecret(config.tokenEncryptionKey)

  return {
    authStateStore: new D1AuthStateStore(bindings.APP_DB),
    exchangeCodeStore: new D1ExchangeCodeStore(bindings.APP_DB),
    sessionStore: new CloudflareKVSessionStore(bindings.AUTH_KV),
    googleTokenStore: new D1GoogleTokenStore(bindings.APP_DB, cipher)
  }
}
