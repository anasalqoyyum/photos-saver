import Fastify, { FastifyInstance } from 'fastify'

import { AppConfig, loadConfig } from './config.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerPhotosRoutes } from './routes/photos.js'
import { createStoresForRuntime } from './store-factory.js'
import { WorkerBindings } from './worker-bindings.js'

interface BuildAppOptions {
  logger?: boolean
}

type CorsOriginConfig = true | string | Array<string | RegExp>

const LOCAL_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/
]

const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/

function defaultCorsOrigins(): RegExp[] {
  return [...LOCAL_ORIGIN_PATTERNS, EXTENSION_ORIGIN_PATTERN]
}

function parseCorsOrigin(
  corsOrigin: string | undefined
): CorsOriginConfig {
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

function registerCorsHooks(app: FastifyInstance, corsConfig: CorsOriginConfig): void {
  app.addHook('onRequest', async (request, reply) => {
    const originHeader = request.headers.origin
    const method = request.method

    let allowOrigin: string | null = null
    if (originHeader) {
      if (isOriginAllowed(originHeader, corsConfig)) {
        allowOrigin = corsConfig === true ? '*' : originHeader
      }
    } else if (corsConfig === true) {
      allowOrigin = '*'
    }

    if (allowOrigin) {
      reply.header('Access-Control-Allow-Origin', allowOrigin)
      if (allowOrigin !== '*') {
        reply.header('Vary', 'Origin')
      }
    }

    if (method !== 'OPTIONS') {
      return
    }

    if (originHeader && !allowOrigin) {
      return reply.code(403).send({ error: 'CORS_ORIGIN_NOT_ALLOWED' })
    }

    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    reply.header('Access-Control-Max-Age', '86400')
    return reply.code(204).send()
  })
}

export async function buildApp(
  config: AppConfig = loadConfig(),
  bindings?: WorkerBindings,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: config.maxUploadBytes * 2
  })

  registerCorsHooks(app, parseCorsOrigin(config.corsOrigin))

  const stores = await createStoresForRuntime(config, bindings)

  await registerAuthRoutes(app, {
    config,
    authStateStore: stores.authStateStore,
    exchangeCodeStore: stores.exchangeCodeStore,
    sessionStore: stores.sessionStore,
    googleTokenStore: stores.googleTokenStore
  })

  await registerPhotosRoutes(app, {
    config,
    sessionStore: stores.sessionStore,
    googleTokenStore: stores.googleTokenStore
  })

  app.get('/health', async () => {
    return {
      status: 'ok'
    }
  })

  return app
}
