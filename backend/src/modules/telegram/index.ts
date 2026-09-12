import type { AppEnv } from '../../env'
import type { BackendRuntime } from '../../runtime'
import { createAcceptTelegramUpdate } from './application/accept-update'
import type { TelegramApiPort } from './application/ports'
import { createTelegramPayloadCrypto } from './infrastructure/payload-crypto'
import { createTelegramApi } from './infrastructure/telegram-api'
import { PrismaTelegramRepository } from './infrastructure/prisma-telegram-repository'
import { createTelegramTaskProcessor } from './infrastructure/process-task'
import { cleanupTelegramVideoNavigationReply } from './application/video-delivery'
import { createTelegramWebhook } from './transport/webhook'

export function createTelegramModule(options: {
  runtime: BackendRuntime
  botId: bigint
  api?: TelegramApiPort
}) {
  const env = options.runtime.env
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_INBOX_ENCRYPTION_KEY) {
    throw new Error('Telegram adapter is not configured')
  }
  const api = options.api ?? createTelegramApi(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_FILE_MAX_BYTES)
  const crypto = createTelegramPayloadCrypto(env.TELEGRAM_INBOX_ENCRYPTION_KEY)
  const acceptUpdate = createAcceptTelegramUpdate({
    botId: options.botId,
    repository: new PrismaTelegramRepository(options.runtime.prisma),
    api,
    encrypt: crypto.encrypt,
  })
  return {
    acceptUpdate,
    api,
    routes: env.TELEGRAM_BOT_MODE === 'webhook'
      ? createTelegramWebhook({
          secret: env.TELEGRAM_WEBHOOK_SECRET!,
          bodyLimitBytes: env.TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES,
          acceptUpdate,
        })
      : null,
  }
}

export function createTelegramTasks(runtime: BackendRuntime) {
  const env = runtime.env
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_INBOX_ENCRYPTION_KEY) {
    throw new Error('Telegram task ran without server-side Telegram configuration')
  }
  const api = createTelegramApi(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_FILE_MAX_BYTES)
  const crypto = createTelegramPayloadCrypto(env.TELEGRAM_INBOX_ENCRYPTION_KEY)
  return {
    process: createTelegramTaskProcessor({ runtime, api, crypto }),
    cleanupNavigationReply: ({ navigationReplyId, now }: { navigationReplyId: string; now: Date }) =>
      cleanupTelegramVideoNavigationReply(runtime.prisma, api, navigationReplyId, now),
  }
}

export function telegramConfigSummary(env: Pick<AppEnv, 'TELEGRAM_BOT_EXPECTED_USERNAME' | 'TELEGRAM_BOT_MODE' | 'TELEGRAM_WEBHOOK_URL' | 'TELEGRAM_MINI_APP_URL'>) {
  return {
    username: `@${env.TELEGRAM_BOT_EXPECTED_USERNAME}`,
    mode: env.TELEGRAM_BOT_MODE,
    webhookUrl: env.TELEGRAM_WEBHOOK_URL ?? 'not configured',
    miniAppUrl: env.TELEGRAM_MINI_APP_URL ?? 'not configured',
  }
}

export { startTelegramPolling } from './transport/polling'
export { createTelegramApi } from './infrastructure/telegram-api'
export { TelegramVideoDeliveryService } from './application/video-delivery'
