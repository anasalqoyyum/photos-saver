import cors from '@fastify/cors'
import Fastify, { FastifyInstance } from 'fastify'

import { AppConfig, loadConfig } from './config.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerPhotosRoutes } from './routes/photos.js'
import { createStoresForRuntime } from './store-factory.js'
import { WorkerBindings } from './worker-bindings.js'

interface BuildAppOptions {
  logger?: boolean
}

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
): true | string | Array<string | RegExp> {
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

export async function buildApp(
  config: AppConfig = loadConfig(),
  bindings?: WorkerBindings,
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: config.maxUploadBytes * 2
  })

  await app.register(cors, {
    origin: parseCorsOrigin(config.corsOrigin),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })

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
