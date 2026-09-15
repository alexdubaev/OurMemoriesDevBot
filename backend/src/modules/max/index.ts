import type { BackendRuntime } from '../../runtime'
import { createInviteStartResolver, createPrismaFamilyAccess } from '../families'
import { createMaxAcceptUpdate } from './application/accept-update'
import type { MaxApiPort, MaxBotIdentity } from './application/ports'
import { createMaxApi } from './infrastructure/max-api'
import { createMaxPayloadCrypto } from './infrastructure/payload-crypto'
import { createMaxResponseDelivery } from './infrastructure/deliver-response'
import { createMaxTaskProcessor } from './infrastructure/process-task'
import { PrismaMaxRepository } from './infrastructure/prisma-max-repository'
import { createMaxWebhook } from './transport/webhook'
import { createMediaService } from '../media'
import { createMaxMediaDownload } from './infrastructure/media-download'
import { createMaxVideoPlayback } from './infrastructure/video-playback'

export function createMaxModule(options: {
  runtime: BackendRuntime
  identity: MaxBotIdentity
  api?: MaxApiPort
}) {
  const env = options.runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_SECRET || !env.MAX_INBOX_ENCRYPTION_KEY) throw new Error('MAX adapter is not configured')
  const api = options.api ?? createMaxApi(env.MAX_BOT_TOKEN)
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const storage = options.runtime.privateStorage?.storage
  const media = storage ? createMediaService({ db: options.runtime.prisma, env, familyAccess: createPrismaFamilyAccess(options.runtime.prisma), storage }) : undefined
  const acceptUpdate = createMaxAcceptUpdate({
    botId: String(options.identity.userId),
    repository: new PrismaMaxRepository(options.runtime.prisma),
    encrypt: crypto.encrypt,
  })
  const processTask = createMaxTaskProcessor({
    runtime: options.runtime,
    crypto,
    api,
    ...(media ? { media, download: createMaxMediaDownload() } : {}),
    resolveInviteStart: createInviteStartResolver(options.runtime.prisma),
  })
  return {
    api,
    processTask,
    videoPlayback: createMaxVideoPlayback({ runtime: options.runtime, api }),
    routes: createMaxWebhook({
      secret: env.MAX_WEBHOOK_SECRET,
      bodyLimitBytes: env.MAX_WEBHOOK_BODY_LIMIT_BYTES,
      acceptUpdate,
    }),
  }
}

export function createMaxTasks(runtime: BackendRuntime) {
  const env = runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_INBOX_ENCRYPTION_KEY) {
    throw new Error('MAX task ran without server-side MAX configuration')
  }
  const api = createMaxApi(env.MAX_BOT_TOKEN)
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const processTask = createMaxTaskProcessor({
    runtime,
    crypto,
    api,
    media: createMediaService({ db: runtime.prisma, env, familyAccess: createPrismaFamilyAccess(runtime.prisma), storage: runtime.privateStorage.storage }),
    download: createMaxMediaDownload(),
    resolveInviteStart: createInviteStartResolver(runtime.prisma),
  })
  return {
    process: (payload: unknown, signal?: AbortSignal) => processTask(payload, signal),
    deliverResponse: createMaxResponseDelivery({ prisma: runtime.prisma, api }),
  }
}

export { createMaxApi, MaxProviderError } from './infrastructure/max-api'
export type { MaxApiPort, MaxBotIdentity, MaxInboundAttachment, MaxInboundEvent, MaxResolvedAttachment, MaxResolvedMessage, MaxSendMessageInput, MaxSubscription, MaxSubscriptionInput, MaxVideoResolution, MaxVideoRendition } from './application/ports'
