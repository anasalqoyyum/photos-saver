import { buildApp } from './app.js'

const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '0.0.0.0'

const app = await buildApp()

try {
  const address = await app.listen({ port, host })
  app.log.info({ address }, 'Backend server started')
} catch (error) {
  app.log.error(error, 'Failed to start backend server')
  process.exit(1)
}
