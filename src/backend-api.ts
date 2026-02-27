import { BACKEND_BASE_URL } from './backend-config.js'
import { ExtensionError } from './errors.js'
import { FetchedImage } from './image-fetch.js'
import { debug, warn } from './logger.js'

interface BackendSession {
  token: string
  expiresAt: number
}

let backendSession: BackendSession | null = null

function getBackendBaseUrl(): string {
  const value = BACKEND_BASE_URL.trim()
  if (!value || value.includes('REPLACE_WITH_BACKEND_URL')) {
    throw new ExtensionError(
      'AUTH_FAILED',
      'Backend mode is enabled but BACKEND_BASE_URL is not configured.'
    )
  }

  return value.replace(/\/$/, '')
}

function shouldReuseSession(session: BackendSession | null): boolean {
  if (!session) {
    return false
  }

  return Date.now() + 30_000 < session.expiresAt
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function launchWebAuthFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      {
        url,
        interactive: true
      },
      redirectUrl => {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) {
          reject(
            new ExtensionError(
              'AUTH_FAILED',
              runtimeError.message || 'Backend OAuth web flow failed.'
            )
          )
          return
        }

        if (!redirectUrl) {
          reject(
            new ExtensionError(
              'AUTH_FAILED',
              'Backend OAuth web flow did not return redirect URL.'
            )
          )
          return
        }

        resolve(redirectUrl)
      }
    )
  })
}

async function ensureBackendSessionToken(): Promise<string> {
  const existingSession = backendSession
  if (existingSession && shouldReuseSession(existingSession)) {
    return existingSession.token
  }

  const backendBaseUrl = getBackendBaseUrl()
  const extensionRedirectUri = chrome.identity.getRedirectURL()

  debug('Starting backend auth flow.', {
    backendBaseUrl,
    extensionRedirectUri
  })

  const startResponse = await fetch(`${backendBaseUrl}/v1/auth/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      extensionRedirectUri
    })
  })

  if (!startResponse.ok) {
    throw new ExtensionError(
      'AUTH_FAILED',
      `Backend auth start failed with status ${startResponse.status}.`
    )
  }

  const startPayload = (await startResponse.json()) as {
    authUrl?: string
  }

  const authUrl = startPayload.authUrl
  if (!authUrl) {
    throw new ExtensionError('AUTH_FAILED', 'Backend auth start returned no authUrl.')
  }

  const redirectUrl = await launchWebAuthFlow(authUrl)
  const redirect = new URL(redirectUrl)
  const sessionCode = redirect.searchParams.get('session_code')
  if (!sessionCode) {
    throw new ExtensionError(
      'AUTH_FAILED',
      'Backend callback did not include session_code.'
    )
  }

  const exchangeResponse = await fetch(`${backendBaseUrl}/v1/auth/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sessionCode
    })
  })

  if (!exchangeResponse.ok) {
    throw new ExtensionError(
      'AUTH_FAILED',
      `Backend auth exchange failed with status ${exchangeResponse.status}.`
    )
  }

  const exchangePayload = (await exchangeResponse.json()) as {
    sessionToken?: string
    expiresAt?: number
  }

  if (!exchangePayload.sessionToken || typeof exchangePayload.expiresAt !== 'number') {
    throw new ExtensionError('AUTH_FAILED', 'Backend auth exchange returned invalid payload.')
  }

  backendSession = {
    token: exchangePayload.sessionToken,
    expiresAt: exchangePayload.expiresAt
  }

  debug('Backend auth session established.', {
    expiresAt: exchangePayload.expiresAt
  })

  return backendSession.token
}

async function uploadOnce(image: FetchedImage, token: string): Promise<void> {
  const backendBaseUrl = getBackendBaseUrl()
  const response = await fetch(`${backendBaseUrl}/v1/photos/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      imageBase64: arrayBufferToBase64(image.bytes),
      fileName: image.fileName,
      sourceUrl: image.sourceUrl,
      contentType: image.contentType
    })
  })

  if (response.status === 401) {
    throw new ExtensionError(
      'AUTH_FAILED',
      'Backend session is invalid or expired.'
    )
  }

  if (!response.ok) {
    const text = await response.text()
    throw new ExtensionError(
      'UPLOAD_FAILED',
      `Backend upload failed (${response.status}): ${text.slice(0, 300)}`
    )
  }
}

export async function uploadImageViaBackend(image: FetchedImage): Promise<void> {
  const sessionToken = await ensureBackendSessionToken()

  try {
    await uploadOnce(image, sessionToken)
  } catch (error) {
    const isAuthError =
      error instanceof ExtensionError && error.code === 'AUTH_FAILED'
    if (!isAuthError) {
      throw error
    }

    warn('Backend session rejected upload. Re-authenticating and retrying once.')
    backendSession = null
    const refreshedToken = await ensureBackendSessionToken()
    await uploadOnce(image, refreshedToken)
  }
}
