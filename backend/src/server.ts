import { config as loadDotEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildApp } from './app.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
loadDotEnv({ path: resolve(serverDir, '..', '.env') })

const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '0.0.0.0'

const app = await buildApp()

try {
  const address = await app.listen({ port, host })
  app.log.info({ address }, 'Backend server started')
} catch (error) {
  app.log.error(error, 'Failed to start backend server')
  process.exit(1)
}
