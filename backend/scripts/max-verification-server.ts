import { createApp } from '../src/app'
import { createBackendRuntime } from '../src/runtime'
import { shutdownBackend } from '../src/shutdown'

// MAX browser verification exercises the real signed-initData and browser-link routes against
// PostgreSQL. It deliberately does not start MAX bot identity checks, webhook polling, or any
// provider API client; those are unrelated to the browser authentication contract under test.
assertSyntheticTestEnvironment()
const runtime = createBackendRuntime()
const app = createApp({
  backgroundTasks: runtime.backgroundTasks,
  emailDelivery: runtime.emailDelivery,
  env: runtime.env,
  prisma: runtime.prisma,
  privateStorage: runtime.privateStorage,
})
const server = Bun.serve({ hostname: '127.0.0.1', port: runtime.env.PORT, fetch: app.fetch })
console.log(`MAX verification backend listening on ${server.url}`)

let shuttingDown = false
async function stop(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`MAX verification backend received ${signal}; shutting down`)
  await shutdownBackend(server, runtime, runtime.env.SHUTDOWN_GRACE_SECONDS * 1000)
}

process.on('SIGINT', () => { void stop('SIGINT') })
process.on('SIGTERM', () => { void stop('SIGTERM') })

function assertSyntheticTestEnvironment() {
  if (process.env.NODE_ENV !== 'test') throw new Error('MAX verification server requires NODE_ENV=test')
  const databaseUrl = process.env.DATABASE_URL
  const testDatabaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl || !testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
    throw new Error('MAX verification server requires matching DATABASE_URL and TEST_DATABASE_URL')
  }
  let parsed: URL
  try { parsed = new URL(databaseUrl) } catch { throw new Error('MAX verification server requires a valid test database URL') }
  const hostname = parsed.hostname.toLowerCase()
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname)
    || !/^\/(?:[^/]*_test)$/i.test(parsed.pathname)) {
    throw new Error('MAX verification server requires a loopback database with a *_test name')
  }
}
