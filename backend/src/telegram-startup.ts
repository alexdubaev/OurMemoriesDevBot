import { verifyTelegramBotIdentity } from './modules/auth'
import { createTelegramApi, createTelegramModule } from './modules/telegram'
import type { BackendRuntime } from './runtime'

type TelegramModule = ReturnType<typeof createTelegramModule>

export async function startTelegramIfEnabled(options: {
  runtime: BackendRuntime
  verifyIdentity?: typeof verifyTelegramBotIdentity
  createApi?: typeof createTelegramApi
  createModule?: typeof createTelegramModule
}): Promise<TelegramModule | null> {
  const { runtime } = options
  if (!runtime.env.TELEGRAM_ENABLED) return null

  const token = runtime.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    await runtime.close()
    throw new Error('Telegram is enabled but its bot token is missing')
  }

  const verifyIdentity = options.verifyIdentity ?? verifyTelegramBotIdentity
  const createApi = options.createApi ?? createTelegramApi
  const createModule = options.createModule ?? createTelegramModule

  try {
    const identity = await verifyIdentity({
      token,
      expectedUsername: runtime.env.TELEGRAM_BOT_EXPECTED_USERNAME,
    })
    const api = createApi(token, runtime.env.TELEGRAM_FILE_MAX_BYTES)
    return createModule({ runtime, botId: identity.id, api })
  } catch (error) {
    await runtime.close()
    throw error
  }
}
