import { ExtensionError } from './errors.js'
import { debug, warn } from './logger.js'
import { FIREFOX_WEB_OAUTH_CLIENT_ID, WEB_OAUTH_CLIENT_ID } from './oauth-config.js'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

interface OAuthConfig {
  extensionClientId?: string
  webAuthClientId: string
  scopes: string[]
}

interface TokenResult {
  accessToken: string
  expiresAt?: number
}

function getConfiguredClientId(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.startsWith('REPLACE_WITH_')) {
    return null
  }

  return trimmed
}

export function isFirefoxRedirectUri(redirectUri: string): boolean {
  try {
    const parsed = new URL(redirectUri)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname.endsWith('.extensions.mozilla.org') || parsed.hostname.endsWith('.extensions.allizom.org'))
    )
  } catch {
    return false
  }
}

function getOAuthConfigFromManifest(redirectUri: string): OAuthConfig {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    oauth2?: {
      client_id?: string
      scopes?: string[]
    }
  }

  const scopes = manifest.oauth2?.scopes ?? []
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth scopes are missing in manifest.json.')
  }

  if (isFirefoxRedirectUri(redirectUri)) {
    const firefoxWebAuthClientId = getConfiguredClientId(FIREFOX_WEB_OAUTH_CLIENT_ID)
    if (!firefoxWebAuthClientId) {
      throw new ExtensionError('AUTH_FAILED', 'Firefox OAuth requires FIREFOX_WEB_OAUTH_CLIENT_ID in src/oauth-config.ts.')
    }

    return {
      webAuthClientId: firefoxWebAuthClientId,
      scopes
    }
  }

  const extensionClientId = getConfiguredClientId(manifest.oauth2?.client_id)
  if (!extensionClientId) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth client_id is missing in manifest.json.')
  }

  const webAuthClientId = getConfiguredClientId(WEB_OAUTH_CLIENT_ID) ?? extensionClientId

  return {
    extensionClientId,
    webAuthClientId,
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

  const verifierHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))

  const codeChallenge = toBase64Url(new Uint8Array(verifierHash))

  return {
    codeVerifier,
    codeChallenge
  }
}

function createOAuthState(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(24)))
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
          reject(new ExtensionError('AUTH_FAILED', runtimeError.message || 'OAuth web flow failed.'))
          return
        }

        if (!redirectUrl) {
          reject(new ExtensionError('AUTH_FAILED', 'OAuth web flow returned no redirect URL.'))
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
    let providerError = 'unknown_error'
    let providerDescription = text

    try {
      const json = JSON.parse(text) as {
        error?: string
        error_description?: string
      }

      providerError = json.error || providerError
      providerDescription = json.error_description || providerDescription
    } catch {
      // Keep raw text when JSON parsing fails.
    }

    warn('Token exchange failed.', {
      status: response.status,
      error: providerError,
      description: providerDescription.slice(0, 300)
    })

    if (providerError === 'invalid_client' && providerDescription.toLowerCase().includes('client_secret')) {
      throw new ExtensionError(
        'AUTH_FAILED',
        'OAuth token exchange requires client_secret for this client. Use a Chrome Extension OAuth client ID for PKCE fallback, or leave WEB_OAUTH_CLIENT_ID as placeholder to reuse manifest oauth2.client_id.'
      )
    }

    throw new ExtensionError('AUTH_FAILED', `OAuth token exchange failed (${providerError}): ${providerDescription}`)
  }

  const payload = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }

  if (!payload.access_token) {
    throw new ExtensionError('AUTH_FAILED', 'OAuth token response did not include access_token.')
  }

  const expiresAt = typeof payload.expires_in === 'number' ? Date.now() + payload.expires_in * 1000 : undefined

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
  const redirectUri = chrome.identity.getRedirectURL()
  const oauthConfig = getOAuthConfigFromManifest(redirectUri)

  if (oauthConfig.extensionClientId && oauthConfig.webAuthClientId === oauthConfig.extensionClientId) {
    warn('PKCE flow is using extension OAuth client ID. A separate Web client ID is recommended.')
  }

  const runFlow = async (clientId: string): Promise<TokenResult> => {
    const { codeVerifier, codeChallenge } = await createPkcePair()
    const expectedState = createOAuthState()

    const authUrl = new URL(AUTH_ENDPOINT)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', oauthConfig.scopes.join(' '))
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', expectedState)
    authUrl.searchParams.set('include_granted_scopes', 'true')
    authUrl.searchParams.set('access_type', 'online')

    debug('Starting OAuth web auth flow (PKCE fallback).', {
      redirectUri,
      usingClientId: clientId
    })
    const redirectUrl = await launchWebAuthFlow(authUrl.toString())

    const redirect = new URL(redirectUrl)
    const oauthError = redirect.searchParams.get('error')
    if (oauthError) {
      if (oauthError === 'redirect_uri_mismatch') {
        throw new ExtensionError(
          'AUTH_FAILED',
          `redirect_uri_mismatch: configure OAuth redirect URI ${redirectUri} for client ${clientId}.`
        )
      }

      throw new ExtensionError('AUTH_FAILED', `OAuth provider returned error: ${oauthError}`)
    }

    const receivedState = redirect.searchParams.get('state')
    if (!receivedState || receivedState !== expectedState) {
      throw new ExtensionError('AUTH_FAILED', 'OAuth state did not match the request.')
    }

    const code = redirect.searchParams.get('code')
    if (!code) {
      throw new ExtensionError('AUTH_FAILED', 'OAuth provider did not return an authorization code.')
    }

    debug('OAuth auth code received; exchanging for access token.', {
      usingClientId: clientId
    })
    const token = await exchangeCodeForToken({
      code,
      codeVerifier,
      redirectUri,
      clientId
    })

    debug('OAuth PKCE token exchange completed.', {
      usingClientId: clientId
    })
    return token
  }

  try {
    return await runFlow(oauthConfig.webAuthClientId)
  } catch (error) {
    const extensionClientId = oauthConfig.extensionClientId
    const shouldRetryWithExtensionClient =
      !!extensionClientId &&
      oauthConfig.webAuthClientId !== extensionClientId &&
      error instanceof ExtensionError &&
      error.message.includes('client_secret')

    if (!shouldRetryWithExtensionClient) {
      throw error
    }

    warn('Configured WEB_OAUTH_CLIENT_ID requires client secret. Retrying PKCE with extension client ID.')
    return runFlow(extensionClientId)
  }
}
