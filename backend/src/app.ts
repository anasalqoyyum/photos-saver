import cors from '@fastify/cors'
import Fastify, { FastifyInstance } from 'fastify'

import { AppConfig, loadConfig } from './config.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerPhotosRoutes } from './routes/photos.js'
import {
  InMemoryAuthStateStore,
  InMemoryExchangeCodeStore,
  InMemoryGoogleTokenStore,
  InMemorySessionStore
} from './store.js'

export async function buildApp(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
    bodyLimit: config.maxUploadBytes * 2
  })

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })

  const authStateStore = new InMemoryAuthStateStore()
  const exchangeCodeStore = new InMemoryExchangeCodeStore()
  const sessionStore = new InMemorySessionStore()
  const googleTokenStore = new InMemoryGoogleTokenStore()

  await registerAuthRoutes(app, {
    config,
    authStateStore,
    exchangeCodeStore,
    sessionStore,
    googleTokenStore
  })

  await registerPhotosRoutes(app, {
    config,
    sessionStore,
    googleTokenStore
  })

  app.get('/v1/health', async () => {
    return {
      status: 'ok',
      now: new Date().toISOString()
    }
  })

  return app
}
