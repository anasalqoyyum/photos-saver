import { ALLOWED_EXTENSION_REDIRECT_URI_HOST_SUFFIXES } from './extension-config.js'

export function isValidExtensionRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    return (
      parsed.protocol === 'https:' && ALLOWED_EXTENSION_REDIRECT_URI_HOST_SUFFIXES.some(hostSuffix => parsed.hostname.endsWith(hostSuffix))
    )
  } catch {
    return false
  }
}
