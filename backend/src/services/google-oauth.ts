import { base64UrlToBytes } from '../base64.js'
import { AppConfig } from '../config.js'
import { GoogleTokenResponse } from '../types.js'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function decodeBase64UrlJson<T>(payload: string): T | null {
  try {
    const decodedBytes = base64UrlToBytes(payload)
    const decoded = new TextDecoder().decode(decodedBytes)
    return JSON.parse(decoded) as T
  } catch {
    return null
  }
}

function toGoogleTokenErrorMessage(payload: GoogleTokenResponse): string {
  if (payload.error && payload.error_description) {
    return `${payload.error}: ${payload.error_description}`
  }

  if (payload.error) {
    return payload.error
  }

  return 'unknown_error'
}

export function buildGoogleAuthUrl(params: { config: AppConfig; state: string }): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', params.config.googleClientId)
  url.searchParams.set('redirect_uri', params.config.googleOauthRedirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.config.googleScopes.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('access_type', 'offline')
  if (params.config.googleOauthForceConsent) {
    url.searchParams.set('prompt', 'consent')
  }
  url.searchParams.set('include_granted_scopes', 'true')
  return url.toString()
}

export async function exchangeGoogleAuthCode(params: { config: AppConfig; code: string }): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.config.googleClientId,
    client_secret: params.config.googleClientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.config.googleOauthRedirectUri
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  const payload = (await response.json()) as GoogleTokenResponse
  if (!response.ok) {
    throw new Error(`Google auth code exchange failed: ${toGoogleTokenErrorMessage(payload)}`)
  }

  return payload
}

export async function refreshGoogleAccessToken(params: { config: AppConfig; refreshToken: string }): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: params.config.googleClientId,
    client_secret: params.config.googleClientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken
  })

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  const payload = (await response.json()) as GoogleTokenResponse
  if (!response.ok) {
    throw new Error(`Google access token refresh failed: ${toGoogleTokenErrorMessage(payload)}`)
  }

  return payload
}

export function extractGoogleUserId(idToken: string | undefined): string | null {
  if (!idToken) {
    return null
  }

  const segments = idToken.split('.')
  const payloadSegment = segments[1]
  if (!payloadSegment) {
    return null
  }

  const payload = decodeBase64UrlJson<{ sub?: string }>(payloadSegment)
  if (!payload?.sub) {
    return null
  }

  return payload.sub
}
