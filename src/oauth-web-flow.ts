import { ExtensionError } from './errors.js'
import { debug, warn } from './logger.js'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

interface OAuthConfig {
  clientId: string
  scopes: string[]
}

interface TokenResult {
  accessToken: string
  expiresAt?: number
}

function getOAuthConfigFromManifest(): OAuthConfig {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    oauth2?: {
      client_id?: string
      scopes?: string[]
    }
  }

  const clientId = manifest.oauth2?.client_id?.trim()
  if (!clientId || clientId.startsWith('REPLACE_WITH_')) {
    throw new ExtensionError(
      'AUTH_FAILED',
      'OAuth client_id is missing in manifest.json.'
    )
  }

  const scopes = manifest.oauth2?.scopes ?? []
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth scopes are missing in manifest.json.')
  }

  return {
    clientId,
    scopes
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createPkcePair(): Promise<{
  codeVerifier: string
  codeChallenge: string
}> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32))
  const codeVerifier = toBase64Url(verifierBytes)

  const verifierHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier)
  )

  const codeChallenge = toBase64Url(new Uint8Array(verifierHash))

  return {
    codeVerifier,
    codeChallenge
  }
}

function launchWebAuthFlow(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true
      },
      redirectUrl => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(
            new ExtensionError(
              'AUTH_FAILED',
              runtimeError.message || 'OAuth web flow failed.'
            )
          )
          return
        }

        if (!redirectUrl) {
          reject(
            new ExtensionError('AUTH_FAILED', 'OAuth web flow returned no redirect URL.')
          )
          return
        }

        resolve(redirectUrl)
      }
    )
  })
}

async function exchangeCodeForToken(params: {
  code: string
  codeVerifier: string
  redirectUri: string
  clientId: string
}): Promise<TokenResult> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri
  })

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })

  if (!response.ok) {
    const text = await response.text()
    warn('Token exchange failed.', {
      status: response.status,
      body: text.slice(0, 300)
    })
    throw new ExtensionError(
      'AUTH_FAILED',
      `OAuth token exchange failed with status ${response.status}.`
    )
  }

  const payload = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!payload.access_token) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth token response did not include access_token.')
  }

  const expiresAt =
    typeof payload.expires_in === 'number'
      ? Date.now() + payload.expires_in * 1000
      : undefined

  if (typeof expiresAt === 'number') {
    return {
      accessToken: payload.access_token,
      expiresAt
    }
  }

  return {
    accessToken: payload.access_token
  }
}

export async function getAccessTokenViaWebAuthFlow(): Promise<TokenResult> {
  const oauthConfig = getOAuthConfigFromManifest()
  const { codeVerifier, codeChallenge } = await createPkcePair()
  const redirectUri = chrome.identity.getRedirectURL('oauth2')

  const authUrl = new URL(AUTH_ENDPOINT)
  authUrl.searchParams.set('client_id', oauthConfig.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', oauthConfig.scopes.join(' '))
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('access_type', 'online')

  debug('Starting OAuth web auth flow (PKCE fallback).')
  const redirectUrl = await launchWebAuthFlow(authUrl.toString())

  const redirect = new URL(redirectUrl)
  const oauthError = redirect.searchParams.get('error')
  if (oauthError) {
    throw new ExtensionError('AUTH_FAILED', `OAuth provider returned error: ${oauthError}`)
  }

  const code = redirect.searchParams.get('code')
  if (!code) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth provider did not return an authorization code.')
  }

  debug('OAuth auth code received; exchanging for access token.')
  const token = await exchangeCodeForToken({
    code,
    codeVerifier,
    redirectUri,
    clientId: oauthConfig.clientId
  })

  debug('OAuth PKCE token exchange completed.')
  return token
}
