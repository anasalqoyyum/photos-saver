import { BACKEND_BASE_URL } from './backend-config.js'
import { ExtensionError } from './errors.js'
import { FetchedImage } from './image-fetch.js'
import { debug, warn } from './logger.js'

interface BackendSession {
  token: string
  expiresAt: number
}

const BACKEND_SESSION_STORAGE_KEY = 'backendSession'
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

let backendSession: BackendSession | null = null
let hasLoadedBackendSession = false
let activeSessionPromise: Promise<string> | null = null

function getBackendBaseUrl(): string {
  const value = BACKEND_BASE_URL.trim()
  if (!value || value.includes('REPLACE_WITH_BACKEND_URL')) {
    throw new ExtensionError('AUTH_FAILED', 'Backend mode is enabled but BACKEND_BASE_URL is not configured.')
  }

  return value.replace(/\/$/, '')
}

function isSessionExpired(session: BackendSession): boolean {
  return Date.now() >= session.expiresAt
}

function shouldRefreshSession(session: BackendSession): boolean {
  return Date.now() + SESSION_REFRESH_WINDOW_MS >= session.expiresAt
}

function isBackendSession(value: unknown): value is BackendSession {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as {
    token?: unknown
    expiresAt?: unknown
  }

  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.expiresAt === 'number' &&
    Number.isFinite(candidate.expiresAt)
  )
}

function getStorageValue(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, values => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new ExtensionError('STORAGE_FAILED', runtimeError.message || 'Failed to read backend session from storage.'))
        return
      }

      resolve(values[key])
    })
  })
}

function setStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new ExtensionError('STORAGE_FAILED', runtimeError.message || 'Failed to persist backend session to storage.'))
        return
      }

      resolve()
    })
  })
}

function removeStorageValue(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        reject(new ExtensionError('STORAGE_FAILED', runtimeError.message || 'Failed to remove backend session from storage.'))
        return
      }

      resolve()
    })
  })
}

async function persistBackendSession(session: BackendSession | null): Promise<void> {
  if (session) {
    await setStorageValue(BACKEND_SESSION_STORAGE_KEY, session)
    return
  }

  await removeStorageValue(BACKEND_SESSION_STORAGE_KEY)
}

async function loadBackendSessionFromStorage(): Promise<void> {
  if (hasLoadedBackendSession) {
    return
  }

  const storedValue = await getStorageValue(BACKEND_SESSION_STORAGE_KEY)
  if (!isBackendSession(storedValue)) {
    hasLoadedBackendSession = true
    return
  }

  backendSession = storedValue
  hasLoadedBackendSession = true

  debug('Reused persisted backend session.', {
    expiresAt: storedValue.expiresAt
  })
}

async function refreshBackendSessionToken(session: BackendSession): Promise<BackendSession | null> {
  const backendBaseUrl = getBackendBaseUrl()
  const response = await fetch(`${backendBaseUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  })

  if (response.status === 401) {
    return null
  }

  if (!response.ok) {
    throw new ExtensionError('AUTH_FAILED', `Backend auth refresh failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as {
    sessionToken?: string
    expiresAt?: number
  }

  if (!payload.sessionToken || typeof payload.expiresAt !== 'number') {
    throw new ExtensionError('AUTH_FAILED', 'Backend auth refresh returned invalid payload.')
  }

  return {
    token: payload.sessionToken,
    expiresAt: payload.expiresAt
  }
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
          reject(new ExtensionError('AUTH_FAILED', runtimeError.message || 'Backend OAuth web flow failed.'))
          return
        }

        if (!redirectUrl) {
          reject(new ExtensionError('AUTH_FAILED', 'Backend OAuth web flow did not return redirect URL.'))
          return
        }

        resolve(redirectUrl)
      }
    )
  })
}

async function resolveBackendSessionToken(rejectedToken?: string): Promise<string> {
  await loadBackendSessionFromStorage()

  if (rejectedToken && backendSession?.token === rejectedToken) {
    await persistBackendSession(null)
    backendSession = null
  }

  const existingSession = backendSession
  if (existingSession) {
    if (!isSessionExpired(existingSession)) {
      if (!shouldRefreshSession(existingSession)) {
        return existingSession.token
      }

      let refreshedSession: BackendSession | null
      try {
        refreshedSession = await refreshBackendSessionToken(existingSession)
      } catch (error) {
        warn('Backend session refresh failed; continuing with existing session.', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
        return existingSession.token
      }

      if (refreshedSession) {
        await persistBackendSession(refreshedSession)
        backendSession = refreshedSession
        debug('Backend auth session refreshed without Google OAuth prompt.', {
          expiresAt: refreshedSession.expiresAt
        })
        return refreshedSession.token
      }
    }

    await persistBackendSession(null)
    backendSession = null
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
    throw new ExtensionError('AUTH_FAILED', `Backend auth start failed with status ${startResponse.status}.`)
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
    throw new ExtensionError('AUTH_FAILED', 'Backend callback did not include session_code.')
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
    throw new ExtensionError('AUTH_FAILED', `Backend auth exchange failed with status ${exchangeResponse.status}.`)
  }

  const exchangePayload = (await exchangeResponse.json()) as {
    sessionToken?: string
    expiresAt?: number
  }

  if (!exchangePayload.sessionToken || typeof exchangePayload.expiresAt !== 'number') {
    throw new ExtensionError('AUTH_FAILED', 'Backend auth exchange returned invalid payload.')
  }

  const session = {
    token: exchangePayload.sessionToken,
    expiresAt: exchangePayload.expiresAt
  }

  await persistBackendSession(session)
  backendSession = session

  debug('Backend auth session established.', {
    expiresAt: exchangePayload.expiresAt
  })

  return session.token
}

async function ensureBackendSessionToken(rejectedToken?: string): Promise<string> {
  if (activeSessionPromise) {
    const token = await activeSessionPromise
    return token === rejectedToken ? ensureBackendSessionToken(rejectedToken) : token
  }

  activeSessionPromise = resolveBackendSessionToken(rejectedToken)
  try {
    return await activeSessionPromise
  } finally {
    activeSessionPromise = null
  }
}

async function uploadOnce(image: FetchedImage, token: string, pageUrl?: string): Promise<void> {
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
      contentType: image.contentType,
      pageUrl: pageUrl?.trim() || null
    })
  })

  if (response.status === 401) {
    throw new ExtensionError('AUTH_FAILED', 'Backend session is invalid or expired.')
  }

  if (!response.ok) {
    const text = await response.text()
    throw new ExtensionError('UPLOAD_FAILED', `Backend upload failed (${response.status}): ${text.slice(0, 300)}`)
  }
}

export async function uploadImageViaBackend(image: FetchedImage, pageUrl?: string): Promise<void> {
  const sessionToken = await ensureBackendSessionToken()

  try {
    await uploadOnce(image, sessionToken, pageUrl)
  } catch (error) {
    const isAuthError = error instanceof ExtensionError && error.code === 'AUTH_FAILED'
    if (!isAuthError) {
      throw error
    }

    warn('Backend session rejected upload. Resolving session and retrying once.')
    const refreshedToken = await ensureBackendSessionToken(sessionToken)
    await uploadOnce(image, refreshedToken, pageUrl)
  }
}
