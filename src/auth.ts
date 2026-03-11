import { ExtensionError } from './errors.js'
import { debug, warn } from './logger.js'
import { getAccessTokenViaWebAuthFlow } from './oauth-web-flow.js'

type AuthTokenResult = chrome.identity.GetAuthTokenResult

interface CachedToken {
  token: string
  expiresAt?: number
}

const TOKEN_EXPIRY_SKEW_MS = 30_000

let pkceTokenCache: CachedToken | null = null

function isLikelyGoogleChrome(): boolean {
  const navWithUaData = navigator as Navigator & {
    userAgentData?: {
      brands?: Array<{
        brand: string
      }>
    }
  }

  const brands = navWithUaData.userAgentData?.brands
  if (Array.isArray(brands) && brands.length > 0) {
    return brands.some(entry => entry.brand.toLowerCase() === 'google chrome')
  }

  const ua = navigator.userAgent || ''
  return /Chrome\/\d+/i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua)
}

function getAuthToken(details: chrome.identity.TokenDetails): Promise<AuthTokenResult> {
  debug('Requesting OAuth token.', { interactive: !!details.interactive })

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken(details, tokenOrResult => {
      const runtimeError = chrome.runtime.lastError
      if (runtimeError) {
        warn('OAuth token request failed.', {
          interactive: !!details.interactive,
          message: runtimeError.message
        })
        reject(new ExtensionError('AUTH_FAILED', runtimeError.message || 'Authentication failed.'))
        return
      }

      if (!tokenOrResult) {
        warn('OAuth token request returned empty result.', {
          interactive: !!details.interactive
        })
        reject(new ExtensionError('AUTH_FAILED', 'No auth token returned.'))
        return
      }

      if (typeof tokenOrResult === 'string') {
        debug('OAuth token request succeeded (string response).', {
          interactive: !!details.interactive
        })
        resolve({ token: tokenOrResult })
        return
      }

      debug('OAuth token request succeeded (object response).', {
        interactive: !!details.interactive,
        grantedScopeCount: tokenOrResult.grantedScopes?.length ?? 0
      })
      resolve(tokenOrResult)
    })
  })
}

function getAuthTokenWithTimeout(details: chrome.identity.TokenDetails, timeoutMs: number): Promise<AuthTokenResult> {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new ExtensionError('AUTH_FAILED', 'Timed out while requesting OAuth token.'))
    }, timeoutMs)

    getAuthToken(details)
      .then(result => {
        clearTimeout(timeoutHandle)
        resolve(result)
      })
      .catch(error => {
        clearTimeout(timeoutHandle)
        reject(error)
      })
  })
}

function getCachedPkceToken(): string | null {
  if (!pkceTokenCache) {
    return null
  }

  if (typeof pkceTokenCache.expiresAt === 'number' && Date.now() + TOKEN_EXPIRY_SKEW_MS >= pkceTokenCache.expiresAt) {
    debug('Cached PKCE token expired. Clearing cache.')
    pkceTokenCache = null
    return null
  }

  return pkceTokenCache.token
}

export async function getAccessToken(): Promise<string> {
  const cachedPkceToken = getCachedPkceToken()
  if (cachedPkceToken) {
    debug('Using cached PKCE token.')
    return cachedPkceToken
  }

  try {
    const result = await getAuthTokenWithTimeout({ interactive: false }, 6_000)
    if (result.token) {
      debug('Using cached OAuth token.')
      return result.token
    }
  } catch (error) {
    warn('Non-interactive token unavailable, falling back to interactive.', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }

  if (!isLikelyGoogleChrome()) {
    debug('Browser does not appear to be Google Chrome; skipping identity interactive flow.')
    const pkceToken = await getAccessTokenViaWebAuthFlow()
    pkceTokenCache =
      typeof pkceToken.expiresAt === 'number'
        ? { token: pkceToken.accessToken, expiresAt: pkceToken.expiresAt }
        : { token: pkceToken.accessToken }

    debug('Using PKCE token acquired via web auth flow.')
    return pkceToken.accessToken
  }

  try {
    debug('Requesting interactive OAuth token.')
    const interactiveResult = await getAuthTokenWithTimeout({ interactive: true }, 20_000)
    if (!interactiveResult.token) {
      throw new ExtensionError('AUTH_FAILED', 'Unable to acquire OAuth token.')
    }

    debug('Interactive OAuth token acquired.')
    return interactiveResult.token
  } catch (error) {
    warn('Chrome identity interactive auth failed. Falling back to PKCE web auth.', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }

  const pkceToken = await getAccessTokenViaWebAuthFlow()
  pkceTokenCache =
    typeof pkceToken.expiresAt === 'number'
      ? { token: pkceToken.accessToken, expiresAt: pkceToken.expiresAt }
      : { token: pkceToken.accessToken }

  debug('Using PKCE token acquired via web auth flow.')
  return pkceToken.accessToken
}

export async function invalidateToken(token: string): Promise<void> {
  if (pkceTokenCache?.token === token) {
    pkceTokenCache = null
  }

  debug('Invalidating cached OAuth token.')
  try {
    await chrome.identity.removeCachedAuthToken({ token })
  } catch (error) {
    warn('Failed to invalidate chrome.identity token cache.', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
