import { AppConfig } from '../config.js'
import {
  emptyResponse,
  errorResponse,
  jsonResponse,
  parseBearerToken,
  readJsonBody,
  redirectResponse
} from '../http.js'
import {
  AuthStateStore,
  ExchangeCodeStore,
  GoogleTokenStore,
  SessionStore
} from '../store.js'
import {
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  extractGoogleUserId
} from '../services/google-oauth.js'

export interface AuthRoutesOptions {
  config: AppConfig
  authStateStore: AuthStateStore
  exchangeCodeStore: ExchangeCodeStore
  sessionStore: SessionStore
  googleTokenStore: GoogleTokenStore
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringField(body: unknown, key: string): string | null {
  if (!isPlainObject(body)) {
    return null
  }

  const value = body[key]
  if (typeof value !== 'string') {
    return null
  }

  return value
}

function isValidExtensionRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.chromiumapp.org')
  } catch {
    return false
  }
}

function withParam(baseUrl: string, key: string, value: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set(key, value)
  return url.toString()
}

export async function handleAuthStart(
  request: Request,
  options: AuthRoutesOptions
): Promise<Response> {
  const body = await readJsonBody(request)
  const extensionRedirectUri = readStringField(body, 'extensionRedirectUri')?.trim()

  if (!extensionRedirectUri || !isValidExtensionRedirectUri(extensionRedirectUri)) {
    return errorResponse(400, 'INVALID_EXTENSION_REDIRECT_URI')
  }

  const state = crypto.randomUUID()
  const createdAt = Date.now()
  await options.authStateStore.create({
    state,
    extensionRedirectUri,
    createdAt,
    expiresAt: createdAt + options.config.authStateTtlMs
  })

  const authUrl = buildGoogleAuthUrl({
    config: options.config,
    state
  })

  return jsonResponse({
    authUrl,
    state
  })
}

export async function handleAuthCallback(
  request: Request,
  options: AuthRoutesOptions
): Promise<Response> {
  const url = new URL(request.url)

  const providerError = url.searchParams.get('error')
  if (providerError) {
    return errorResponse(400, 'OAUTH_PROVIDER_ERROR', {
      detail: url.searchParams.get('error_description') || providerError
    })
  }

  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  if (!state || !code) {
    return errorResponse(400, 'INVALID_CALLBACK_PARAMS')
  }

  const authState = await options.authStateStore.consume(state)
  if (!authState) {
    return errorResponse(400, 'INVALID_OR_EXPIRED_STATE')
  }

  const tokenPayload = await exchangeGoogleAuthCode({
    config: options.config,
    code
  })

  const userId = extractGoogleUserId(tokenPayload.id_token)
  if (!userId) {
    return errorResponse(400, 'MISSING_USER_ID_IN_ID_TOKEN')
  }

  if (options.config.allowedGoogleUserId && options.config.allowedGoogleUserId !== userId) {
    return errorResponse(403, 'GOOGLE_USER_NOT_ALLOWED')
  }

  const existing = await options.googleTokenStore.getByUserId(userId)
  const refreshToken = tokenPayload.refresh_token || existing?.refreshToken
  if (!refreshToken) {
    return errorResponse(400, 'MISSING_REFRESH_TOKEN', {
      detail: 'Google did not return refresh_token and no existing token is stored.'
    })
  }

  await options.googleTokenStore.upsert({
    userId,
    refreshToken,
    ...(tokenPayload.scope ? { scope: tokenPayload.scope } : {}),
    updatedAt: Date.now()
  })

  const exchangeCode = await options.exchangeCodeStore.create(
    userId,
    options.config.exchangeCodeTtlMs
  )

  return redirectResponse(
    withParam(authState.extensionRedirectUri, 'session_code', exchangeCode.code)
  )
}

export async function handleAuthExchange(
  request: Request,
  options: AuthRoutesOptions
): Promise<Response> {
  const body = await readJsonBody(request)
  const sessionCode = readStringField(body, 'sessionCode')?.trim()

  if (!sessionCode) {
    return errorResponse(400, 'MISSING_SESSION_CODE')
  }

  const exchangeCode = await options.exchangeCodeStore.consume(sessionCode)
  if (!exchangeCode) {
    return errorResponse(401, 'INVALID_OR_EXPIRED_SESSION_CODE')
  }

  const session = await options.sessionStore.create(
    exchangeCode.userId,
    options.config.sessionTtlMs
  )

  return jsonResponse({
    sessionToken: session.token,
    expiresAt: session.expiresAt
  })
}

export async function handleAuthRefresh(
  request: Request,
  options: AuthRoutesOptions
): Promise<Response> {
  const token = parseBearerToken(request.headers.get('authorization') || undefined)
  if (!token) {
    return errorResponse(401, 'MISSING_AUTHORIZATION')
  }

  const existingSession = await options.sessionStore.get(token)
  if (!existingSession) {
    return errorResponse(401, 'INVALID_OR_EXPIRED_SESSION')
  }

  const refreshedSession = await options.sessionStore.create(
    existingSession.userId,
    options.config.sessionTtlMs
  )
  await options.sessionStore.revoke(token)

  return jsonResponse({
    sessionToken: refreshedSession.token,
    expiresAt: refreshedSession.expiresAt
  })
}

export async function handleAuthLogout(
  request: Request,
  options: AuthRoutesOptions
): Promise<Response> {
  const token = parseBearerToken(request.headers.get('authorization') || undefined)
  if (!token) {
    return errorResponse(401, 'MISSING_AUTHORIZATION')
  }

  await options.sessionStore.revoke(token)
  return emptyResponse(204)
}
