export interface AppConfig {
  googleClientId: string
  googleClientSecret: string
  googleOauthRedirectUri: string
  googleScopes: string[]
  allowedGoogleUserId?: string
  tokenEncryptionKey?: string
  corsOrigin?: string
  sessionTtlMs: number
  authStateTtlMs: number
  exchangeCodeTtlMs: number
  maxUploadBytes: number
}

function required(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${key}`)
  }

  return value.trim()
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function defaultEnv(): Record<string, string | undefined> {
  if (typeof process !== 'undefined' && process.env) {
    return process.env
  }

  return {}
}

export function loadConfig(
  env: Record<string, string | undefined> = defaultEnv()
): AppConfig {
  const scopeString =
    env.GOOGLE_SCOPES ||
    'https://www.googleapis.com/auth/photoslibrary.appendonly openid email'

  const googleScopes = scopeString
    .split(' ')
    .map(scope => scope.trim())
    .filter(Boolean)

  return {
    googleClientId: required(env.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_ID'),
    googleClientSecret: required(env.GOOGLE_CLIENT_SECRET, 'GOOGLE_CLIENT_SECRET'),
    googleOauthRedirectUri: required(
      env.GOOGLE_OAUTH_REDIRECT_URI,
      'GOOGLE_OAUTH_REDIRECT_URI'
    ),
    googleScopes,
    ...(env.ALLOWED_GOOGLE_USER_ID
      ? { allowedGoogleUserId: env.ALLOWED_GOOGLE_USER_ID.trim() }
      : {}),
    ...(env.TOKEN_ENCRYPTION_KEY
      ? { tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY.trim() }
      : {}),
    ...(env.CORS_ORIGIN?.trim() ? { corsOrigin: env.CORS_ORIGIN.trim() } : {}),
    sessionTtlMs: parseNumber(env.SESSION_TTL_MS, 15 * 60 * 1000),
    authStateTtlMs: parseNumber(env.AUTH_STATE_TTL_MS, 5 * 60 * 1000),
    exchangeCodeTtlMs: parseNumber(env.EXCHANGE_CODE_TTL_MS, 2 * 60 * 1000),
    maxUploadBytes: parseNumber(env.MAX_UPLOAD_BYTES, 25 * 1024 * 1024)
  }
}
