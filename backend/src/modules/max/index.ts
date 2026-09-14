import type { BackendRuntime } from '../../runtime'
import { createMaxAcceptUpdate } from './application/accept-update'
import type { MaxApiPort, MaxBotIdentity } from './application/ports'
import { createMaxApi } from './infrastructure/max-api'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { createMaxTaskProcessor } from './infrastructure/process-task'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { createMaxWebhook } from './transport/webhook'

export function createMaxModule(options: {
  runtime: BackendRuntime
  identity: MaxBotIdentity
  api?: MaxApiPort
}) {
  const env = options.runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_SECRET || !env.MAX_INBOX_ENCRYPTION_KEY) throw new Error('MAX adapter is not configured')
  const api = options.api ?? createMaxApi(env.MAX_BOT_TOKEN)
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const acceptUpdate = createMaxAcceptUpdate({
    botId: String(options.identity.userId),
    repository: new PrismaMaxRepository(options.runtime.prisma),
    encrypt: crypto.encrypt,
  })
  const processTask = createMaxTaskProcessor({ runtime: options.runtime, crypto })
  return {
    api,
    processTask,
    routes: createMaxWebhook({
      secret: env.MAX_WEBHOOK_SECRET,
      bodyLimitBytes: env.MAX_WEBHOOK_BODY_LIMIT_BYTES,
      acceptUpdate,
    }),
  }
}

export { createMaxApi, MaxProviderError } from './infrastructure/max-api'
export type { MaxApiPort, MaxBotIdentity, MaxInboundEvent, MaxSubscription, MaxSubscriptionInput } from './application/ports'
