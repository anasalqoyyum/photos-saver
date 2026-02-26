import { DEBUG_LOG_ENABLED } from './constants.js'

type LogContext = Record<string, unknown> | undefined

const LOG_PREFIX = '[SaveToGooglePhotos]'
const REDACTED_KEYS = ['token', 'authorization', 'accessToken', 'authToken']

function sanitizeContext(context: LogContext): LogContext {
  if (!context) {
    return undefined
  }

  const entries = Object.entries(context).map(([key, value]) => {
    if (REDACTED_KEYS.some(secretKey => key.toLowerCase().includes(secretKey.toLowerCase()))) {
      return [key, '[REDACTED]']
    }

    return [key, value]
  })

  return Object.fromEntries(entries)
}

export function debug(message: string, context?: Record<string, unknown>): void {
  if (!DEBUG_LOG_ENABLED) {
    return
  }

  if (context) {
    console.log(LOG_PREFIX, message, sanitizeContext(context))
    return
  }

  console.log(LOG_PREFIX, message)
}

export function warn(message: string, context?: Record<string, unknown>): void {
  if (context) {
    console.warn(LOG_PREFIX, message, sanitizeContext(context))
    return
  }

  console.warn(LOG_PREFIX, message)
}

export function error(message: string, context?: Record<string, unknown>): void {
  if (context) {
    console.error(LOG_PREFIX, message, sanitizeContext(context))
    return
  }

  console.error(LOG_PREFIX, message)
}
