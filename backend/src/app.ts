import cors from '@fastify/cors'
import Fastify, { FastifyInstance } from 'fastify'

import { AppConfig, loadConfig } from './config.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerPhotosRoutes } from './routes/photos.js'
import { createStoresForRuntime } from './store-factory.js'
import { WorkerBindings } from './worker-bindings.js'

export async function buildApp(
  config: AppConfig = loadConfig(),
  bindings?: WorkerBindings
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: config.maxUploadBytes * 2
  })

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
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

  app.get('/v1/health', async () => {
    return {
      status: 'ok',
      now: new Date().toISOString()
    }
  })

  return app
}
