import { createApp } from './app'
import { verifyTelegramBotIdentity } from './modules/auth'
import { createTelegramApi, createTelegramModule, startTelegramPolling } from './modules/telegram'
import { createBackendRuntime } from './runtime'
import { shutdownBackend } from './shutdown'

const runtime = createBackendRuntime()
let telegram: ReturnType<typeof createTelegramModule> | null = null
if (runtime.env.TELEGRAM_BOT_TOKEN && runtime.env.NODE_ENV !== 'test') {
  try {
    const identity = await verifyTelegramBotIdentity({
      token: runtime.env.TELEGRAM_BOT_TOKEN,
      expectedUsername: runtime.env.TELEGRAM_BOT_EXPECTED_USERNAME,
    })
    const api = createTelegramApi(runtime.env.TELEGRAM_BOT_TOKEN, runtime.env.TELEGRAM_FILE_MAX_BYTES)
    telegram = createTelegramModule({ runtime, botId: identity.id, api })
  } catch (error) {
    await runtime.close()
    throw error
  }
}
const app = createApp({
  backgroundTasks: runtime.backgroundTasks,
  emailDelivery: runtime.emailDelivery,
  env: runtime.env,
  prisma: runtime.prisma,
  privateStorage: runtime.privateStorage,
  telegramRoutes: telegram?.routes,
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
