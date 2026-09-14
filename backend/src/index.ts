import { createApp } from './app'
import { startTelegramPolling } from './modules/telegram'
import { createBackendRuntime } from './runtime'
import { shutdownBackend } from './shutdown'
import { startTelegramIfEnabled } from './telegram-startup'
import { startMaxIfEnabled } from './max-startup'

const runtime = createBackendRuntime()
const telegram = runtime.env.NODE_ENV === 'test'
  ? null
  : await startTelegramIfEnabled({ runtime })
const max = await startMaxIfEnabled({ runtime })
const app = createApp({
  backgroundTasks: runtime.backgroundTasks,
  emailDelivery: runtime.emailDelivery,
  env: runtime.env,
  prisma: runtime.prisma,
  privateStorage: runtime.privateStorage,
  telegramRoutes: telegram?.routes,
  maxRoutes: max?.routes,
})

const server = Bun.serve({
  port: runtime.env.PORT,
  fetch: app.fetch,
})

console.log(`Backend listening on ${server.url}`)

const polling = telegram && runtime.env.TELEGRAM_BOT_MODE === 'polling'
  ? startTelegramPolling({ api: telegram.api, acceptUpdate: telegram.acceptUpdate })
  : null

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`Backend received ${signal}; shutting down`)
  polling?.stop()
  if (polling) await polling.stopped
  await shutdownBackend(
    server,
    runtime,
    runtime.env.SHUTDOWN_GRACE_SECONDS * 1000,
  )
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
