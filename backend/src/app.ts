import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { AppConfig, loadConfig } from './config.js'
import { errorResponse, jsonResponse } from './http.js'
import {
  AuthRoutesOptions,
  handleAuthCallback,
  handleAuthExchange,
  handleAuthRefresh,
  handleAuthLogout,
  handleAuthStart
} from './routes/auth.js'
import { handlePhotoUpload, PhotosRoutesOptions } from './routes/photos.js'
import { createStoresForRuntime } from './store-factory.js'
import { WorkerBindings } from './worker-bindings.js'

export interface WorkerApp {
  fetch(request: Request): Promise<Response>
}

type CorsOriginConfig = true | string | Array<string | RegExp>

const LOCAL_ORIGIN_PATTERNS = [/^http:\/\/localhost(?::\d+)?$/, /^http:\/\/127\.0\.0\.1(?::\d+)?$/]

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/

function defaultCorsOrigins(): RegExp[] {
  return [...LOCAL_ORIGIN_PATTERNS, EXTENSION_ORIGIN_PATTERN]
}

function parseCorsOrigin(corsOrigin: string | undefined): CorsOriginConfig {
  if (!corsOrigin) {
    return defaultCorsOrigins()
  }

  if (corsOrigin === '*') {
    return true
  }

  const parts = corsOrigin
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return defaultCorsOrigins()
  }

  if (parts.length === 1) {
    const [singleOrigin] = parts
    if (singleOrigin) {
      return singleOrigin
    }

    return defaultCorsOrigins()
  }

  return parts
}

function isOriginAllowed(origin: string, config: CorsOriginConfig): boolean {
  if (config === true) {
    return true
  }

  if (typeof config === 'string') {
    return origin === config
  }

  return config.some(rule => {
    if (typeof rule === 'string') {
      return origin === rule
    }

    return rule.test(origin)
  })
}

function corsOriginValue(
  origin: string,
  config: CorsOriginConfig
): string | undefined {
  if (!origin) {
    return config === true ? '*' : undefined
  }

  if (!isOriginAllowed(origin, config)) {
    return undefined
  }

  return config === true ? '*' : origin
}

export async function buildApp(config: AppConfig = loadConfig(), bindings?: WorkerBindings): Promise<WorkerApp> {
  const stores = await createStoresForRuntime(config, bindings)
  const corsConfig = parseCorsOrigin(config.corsOrigin)

  const authOptions: AuthRoutesOptions = {
    config,
    authStateStore: stores.authStateStore,
    exchangeCodeStore: stores.exchangeCodeStore,
    sessionStore: stores.sessionStore,
    googleTokenStore: stores.googleTokenStore
  }

  const photosOptions: PhotosRoutesOptions = {
    config,
    sessionStore: stores.sessionStore,
    googleTokenStore: stores.googleTokenStore
  }

  const app = new Hono()

  app.use('*', async (c, next) => {
    const origin = c.req.header('origin')
    if (
      c.req.method === 'OPTIONS' &&
      origin &&
      !isOriginAllowed(origin, corsConfig)
    ) {
      return errorResponse(403, 'CORS_ORIGIN_NOT_ALLOWED')
    }

    await next()
  })

  app.use(
    '*',
    cors({
      origin: origin => corsOriginValue(origin, corsConfig),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400
    })
  )

  app.get('/health', () => {
    return jsonResponse({
      status: 'ok'
    })
  })

  app.get('/v1/health', () => {
    return jsonResponse({
      status: 'ok'
    })
  })
  app.post('/v1/auth/start', c => handleAuthStart(c.req.raw, authOptions))
  app.get('/v1/auth/callback', c => handleAuthCallback(c.req.raw, authOptions))
  app.post('/v1/auth/exchange', c => handleAuthExchange(c.req.raw, authOptions))
  app.post('/v1/auth/refresh', c => handleAuthRefresh(c.req.raw, authOptions))
  app.post('/v1/auth/logout', c => handleAuthLogout(c.req.raw, authOptions))
  app.post('/v1/photos/upload', c =>
    handlePhotoUpload(c.req.raw, photosOptions)
  )

  app.notFound(() => errorResponse(404, 'NOT_FOUND'))

  app.onError(error => {
    console.error('Backend request failed.', error)
    return errorResponse(500, 'INTERNAL_SERVER_ERROR')
  })

  return {
    async fetch(request: Request): Promise<Response> {
      return app.fetch(request)
    }
  }
}
