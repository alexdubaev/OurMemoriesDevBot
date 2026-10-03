import type { BackendRuntime } from '../../runtime'
import { createDetailedInviteStartResolver, createPrismaFamilyAccess } from '../families'
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
import { PrismaMaxDirectUploadRepository } from './infrastructure/prisma-max-direct-upload-repository'
import { createMaxDirectVideoUploadService } from './application/direct-video-upload'
import { createSourceMemoryPublisher } from '../memories'
import { PrismaMemoryRepository } from '../memories'
import { createPrismaIdempotencyExecutor } from '../../idempotency'
import { createAuthModule } from '../auth'
import { createMaxDirectVideoUploadRoutes } from './transport/direct-video-upload-routes'
import { disabledEmailDelivery } from '../../email'
import { createMaxMemoryBackupProcessor, createPrismaMaxMemoryBackupRepository } from './infrastructure/backup-media'
import { createMaxChannelProvider } from './infrastructure/max-channel-provider'
import { createMaxChannelOnboarding } from './application/channel-onboarding'
import { createMaxVideoPosterProcessor, enqueueMaxVideoPoster } from './infrastructure/video-poster'
import { Hono } from 'hono'
import type { AuthHttpEnv } from '../auth'

export function createMaxModule(options: {
  runtime: BackendRuntime
  identity: MaxBotIdentity
  api?: MaxApiPort
  channelVerifier?: (chatId: bigint) => Promise<{ title: string | null }>
  channelActorAdminVerifier?: (chatId: bigint, actorSubject: bigint) => Promise<boolean>
}) {
  const env = options.runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_SECRET || !env.MAX_INBOX_ENCRYPTION_KEY) throw new Error('MAX adapter is not configured')
  const api = options.api ?? createMaxApi(env.MAX_BOT_TOKEN)
  const channelProvider = createMaxChannelProvider(env.MAX_BOT_TOKEN)
  const channelOnboarding = createMaxChannelOnboarding({
    prisma: options.runtime.prisma,
    verifyChannel: options.channelVerifier ?? (options.api ? async () => { throw new Error('MAX channel verification is unavailable') } : channelProvider.verifyChannel),
    verifyActorAdmin: options.channelActorAdminVerifier ?? (options.api ? undefined : channelProvider.verifyActorAdmin),
  })
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const access = createPrismaFamilyAccess(options.runtime.prisma)
  const directVideoUploadService = createMaxDirectVideoUploadService({
    access,
    api,
    repository: new PrismaMaxDirectUploadRepository(options.runtime.prisma),
    publisher: createSourceMemoryPublisher(options.runtime.prisma, access),
    memoryReader: new PrismaMemoryRepository(options.runtime.prisma, createPrismaIdempotencyExecutor(options.runtime.prisma)),
    enqueueVideoPoster: enqueueMaxVideoPoster,
  })
  const directVideoUploadRoutes = createMaxDirectVideoUploadRoutes({
    requireAuth: createAuthModule({ db: options.runtime.prisma, emailDelivery: options.runtime.emailDelivery ?? disabledEmailDelivery, env }).requireAuth,
    service: directVideoUploadService,
  })
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
    resolveDetailedInviteStart: createDetailedInviteStartResolver(options.runtime.prisma),
    processChannelLifecycle: channelOnboarding.processLifecycle,
    processChannelCallback: channelOnboarding.processCallback,
    offerActorChannelConnection: channelOnboarding.offerActorChannelConnection,
  })
  const requireAuth = createAuthModule({ db: options.runtime.prisma, emailDelivery: options.runtime.emailDelivery ?? disabledEmailDelivery, env }).requireAuth
  const channelStatusRoutes = new Hono<AuthHttpEnv>()
  channelStatusRoutes.use('/families/*', requireAuth)
  channelStatusRoutes.get('/families/:familyId/max-channel', async (c) => {
    const familyId = c.req.param('familyId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId)) return c.json({ error: 'NOT_FOUND' }, 404)
    try { return c.json(await channelOnboarding.status(familyId, c.var.user.id), 200) }
    catch { return c.json({ error: 'NOT_FOUND' }, 404) }
  })
  return {
    api,
    processTask,
    directVideoUploadService,
    videoPlayback: createMaxVideoPlayback({ runtime: options.runtime, api }),
    routes: createMaxWebhook({
      secret: env.MAX_WEBHOOK_SECRET,
      bodyLimitBytes: env.MAX_WEBHOOK_BODY_LIMIT_BYTES,
      acceptUpdate,
    }).route('/api/v1', directVideoUploadRoutes).route('/api/v1', channelStatusRoutes),
  }
}

export function createMaxTasks(runtime: BackendRuntime) {
  const env = runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_INBOX_ENCRYPTION_KEY) {
    throw new Error('MAX task ran without server-side MAX configuration')
  }
  const api = createMaxApi(env.MAX_BOT_TOKEN)
  const channelProvider = createMaxChannelProvider(env.MAX_BOT_TOKEN)
  const channelOnboarding = createMaxChannelOnboarding({ prisma: runtime.prisma, verifyChannel: channelProvider.verifyChannel,
    verifyActorAdmin: channelProvider.verifyActorAdmin })
  const crypto = createMaxPayloadCrypto(env.MAX_INBOX_ENCRYPTION_KEY)
  const processTask = createMaxTaskProcessor({
    runtime,
    crypto,
    api,
    media: createMediaService({ db: runtime.prisma, env, familyAccess: createPrismaFamilyAccess(runtime.prisma), storage: runtime.privateStorage.storage }),
    download: createMaxMediaDownload(),
    resolveDetailedInviteStart: createDetailedInviteStartResolver(runtime.prisma),
    processChannelLifecycle: channelOnboarding.processLifecycle,
    processChannelCallback: channelOnboarding.processCallback,
    offerActorChannelConnection: channelOnboarding.offerActorChannelConnection,
  })
  const processBackupMedia = createMaxMemoryBackupProcessor({
    repository: createPrismaMaxMemoryBackupRepository(runtime.prisma),
    storage: runtime.privateStorage.storage,
    api,
  })
  const videoPoster = createMaxVideoPosterProcessor({
    prisma: runtime.prisma,
    familyAccess: createPrismaFamilyAccess(runtime.prisma),
    api,
    media: createMediaService({ db: runtime.prisma, env: runtime.env, familyAccess: createPrismaFamilyAccess(runtime.prisma), storage: runtime.privateStorage.storage }),
  })
  return {
    process: (payload: unknown, signal?: AbortSignal) => processTask(payload, signal),
    deliverResponse: createMaxResponseDelivery({
      prisma: runtime.prisma,
      api,
      crypto,
      maxBotUsername: env.MAX_BOT_EXPECTED_USERNAME,
      resolveDetailedInviteStart: createDetailedInviteStartResolver(runtime.prisma),
    }),
    backupMedia: processBackupMedia,
    videoPoster,
  }
}

export { createMaxApi, MaxProviderError } from './infrastructure/max-api'
export type { MaxApiPort, MaxBotIdentity, MaxInboundAttachment, MaxInboundEvent, MaxResolvedAttachment, MaxResolvedMessage, MaxSendMessageInput, MaxSubscription, MaxSubscriptionInput, MaxVideoResolution, MaxVideoRendition } from './application/ports'
