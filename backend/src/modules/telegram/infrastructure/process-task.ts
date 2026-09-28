import { createHash, randomUUID } from 'node:crypto'

import type { MemoryKind } from '../../../generated/prisma/enums'
import { Client } from 'pg'
import type { DbClient } from '../../../db'
import type { AppEnv } from '../../../env'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createPrismaFamilyAccess, type FamilyScope } from '../../families'
import { createMediaService, MediaFailure } from '../../media'
import { createSourceMemoryPublisher } from '../../memories'
import { CaptionService } from '../application/captions'
import { TelegramVideoDeliveryService } from '../application/video-delivery'
import { PrismaCaptionRepository } from './prisma-caption-repository'
import { PrismaTelegramRepository } from './prisma-telegram-repository'
import type { TelegramApiPort } from '../application/ports'
import type { TelegramInboundEvent, TelegramMediaEvent } from '../domain/inbound-event'
import { choicePayload, parseChoicePayload, readCandidates, savedFamilyText } from '../../../bot-family-target'
import { chooseTelegramTarget, expireTelegramChoice } from './source-target'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
  encrypt(value: unknown): { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }
}

export function createTelegramTaskProcessor(options: {
  runtime: BackendRuntime
  api: TelegramApiPort
  crypto: PayloadCrypto
}) {
  const { prisma, env } = options.runtime
  const access = createPrismaFamilyAccess(prisma)
  const media = createMediaService({ db: prisma, env, familyAccess: access, storage: options.runtime.privateStorage.storage })
  const memories = createSourceMemoryPublisher(prisma, access)
  const videoDelivery = new TelegramVideoDeliveryService(prisma, access, env.TELEGRAM_BOT_EXPECTED_USERNAME)

  return async (payload: unknown, signal?: AbortSignal) => {
    const ids = taskPayload(payload)
    if (ids.inboxId) return processInbox(prisma, options.api, options.crypto, env, videoDelivery, ids.inboxId)
    if (ids.sourceId) return processSource(prisma, options.api, options.crypto, env, media, memories, ids.sourceId, signal)
    if (ids.albumId) return processAlbum(prisma, options.api, options.crypto, env, media, memories, ids.albumId, signal)
    throw new TerminalTaskError('Telegram task payload has no supported id')
  }
}

async function processInbox(
  db: DbClient,
  api: TelegramApiPort,
  crypto: PayloadCrypto,
  env: AppEnv,
  videoDelivery: TelegramVideoDeliveryService,
  inboxId: string,
) {
  const inbox = await db.telegramInbox.findUnique({ where: { id: inboxId } })
  if (!inbox || inbox.processedAt) return 'skipped' as const
  const event = decryptEvent(crypto, inbox)
  if (!requiresInboxLock(event)) return processInboxLocked(db, api, crypto, env, videoDelivery, inboxId)
  return withInboxLock(env.DATABASE_URL, inboxId, () =>
    processInboxLocked(db, api, crypto, env, videoDelivery, inboxId),
  )
}

async function processInboxLocked(
  db: DbClient,
  api: TelegramApiPort,
  crypto: PayloadCrypto,
  env: AppEnv,
  videoDelivery: TelegramVideoDeliveryService,
  inboxId: string,
) {
  const inbox = await db.telegramInbox.findUnique({ where: { id: inboxId } })
  if (!inbox || inbox.processedAt) return 'skipped' as const
  const event = decryptEvent(crypto, inbox)
  if (event.kind === 'denied_content') {
    await api.sendMessage(event.chatId, 'Материал не сохранён: нужна активная семья с правом публикации и профилем ребёнка.', openButton(env))
  } else if (event.kind === 'family_choice') {
    const parsed = parseChoicePayload(event.payload)
    const result = parsed ? await chooseTelegramTarget(db, { sourceId: parsed.sourceId, index: parsed.index,
      senderSubject: event.senderId, chatId: event.chatId }) : 'denied'
    await api.answerCallbackQuery?.(event.callbackId, result === 'chosen' ? 'Семья выбрана. Сохраняем…' :
      result === 'already_chosen' ? 'Семья для этой отправки уже выбрана.' :
      result === 'expired' ? 'Время выбора истекло. Отправьте материал заново.' : 'Этот выбор недоступен.')
  } else if (event.kind === 'command') {
    if (event.command === 'start') {
      const delivery = await videoDelivery.deliverFromStart(event.senderId, event.chatId, event.argument, api, crypto)
      if (delivery === 'denied') {
        await api.sendMessage(event.chatId, 'Видео недоступно или у вас нет доступа.')
      } else if (delivery === 'ambiguous') {
        await api.sendMessage(event.chatId, 'Не удалось подтвердить доставку видео. Откройте его заново в Mini App.')
      }
      if (delivery !== 'not_video_pointer') {
        await db.telegramInbox.update({ where: { id: inboxId }, data: processedInboxData() })
        return
      }
    }
    const inviteToken = event.command === 'start' ? inviteTokenFromStartArgument(event.argument) : null
    const cancelled = event.command === 'cancel' ? await cancelCaption(db, event) : false
    const inviteStart = inviteToken ? await inviteStartResponse(db, env, inviteToken) : null
    await api.sendMessage(
      event.chatId,
      inviteStart?.text ?? commandText(event.command, cancelled),
      inviteStart ? inviteStart.options : commandButtons(env, event.command, null),
    )
  } else if (event.kind === 'caption_reply') {
    await consumeCaptionReply(db, api, event)
  } else {
    throw new TerminalTaskError('Telegram inbox task references unexpected content')
  }
  await db.telegramInbox.update({ where: { id: inboxId }, data: processedInboxData() })
}

async function consumeCaptionReply(db: DbClient, api: TelegramApiPort, event: Extract<TelegramInboundEvent, { kind: 'caption_reply' }>) {
  const admission = await new PrismaTelegramRepository(db).findAdmission(event.senderId)
  if (!admission || admission.role !== 'full') return
  const request = await db.captionRequest.findUnique({ where: { chatId_promptMessageId: {
    chatId: BigInt(event.chatId), promptMessageId: BigInt(event.replyToMessageId),
  } }, select: { familyId: true, userId: true } })
  if (!request || request.userId !== admission.userId) return
  const result = await new CaptionService(new PrismaCaptionRepository(db)).consumeReply({ familyId: request.familyId, userId: admission.userId,
    chatId: event.chatId, replyToMessageId: event.replyToMessageId, text: event.text })
  if (result.kind === 'expired') {
    await api.sendMessage(event.chatId, 'Срок добавления подписи истёк. Откройте запись в семейной ленте, чтобы изменить её.')
  } else if (result.kind === 'forbidden') {
    await api.sendMessage(event.chatId, 'Подпись не сохранена: доступ к семейному архиву недоступен.')
  } else if (result.kind === 'stale') {
    await renewCaptionRequest(db, api, { familyId: request.familyId, userId: admission.userId }, event)
  }
}

async function renewCaptionRequest(
  db: DbClient,
  api: TelegramApiPort,
  admission: { familyId: string; userId: string },
  event: Extract<TelegramInboundEvent, { kind: 'caption_reply' }>,
) {
  const prior = await db.captionRequest.findFirst({ where: { familyId: admission.familyId, userId: admission.userId,
    chatId: BigInt(event.chatId), promptMessageId: BigInt(event.replyToMessageId) } })
  if (!prior) return
  const memory = await db.memory.findFirst({ where: { id: prior.memoryId, familyId: admission.familyId, deletedAt: null }, select: { version: true } })
  if (!memory) return
  const sent = await api.sendMessage(event.chatId, 'Подпись уже изменилась. Ответьте на это сообщение в течение 10 минут, чтобы повторить изменение.', { forceReply: true })
  if (!sent || !('messageId' in sent)) return
  await db.captionRequest.upsert({ where: { chatId_promptMessageId: { chatId: BigInt(event.chatId), promptMessageId: BigInt(sent.messageId) } },
    create: { familyId: admission.familyId, userId: admission.userId, memoryId: prior.memoryId, chatId: BigInt(event.chatId),
      promptMessageId: BigInt(sent.messageId), expectedVersion: memory.version, expiresAt: new Date(Date.now() + 10 * 60_000) }, update: {} })
}

async function cancelCaption(db: DbClient, event: Extract<TelegramInboundEvent, { kind: 'command' }>) {
  const admission = await new PrismaTelegramRepository(db).findAdmission(event.senderId)
  if (!admission || admission.role !== 'full') return false
  const changed = await db.captionRequest.updateMany({ where: { userId: admission.userId, chatId: BigInt(event.chatId), consumedAt: null, cancelledAt: null },
    data: { cancelledAt: new Date() } })
  return changed.count > 0
}
type TargetedSource = NonNullable<Awaited<ReturnType<typeof loadSource>>> & { familyId: string; childId: string }

async function processSource(
  db: DbClient,
  api: TelegramApiPort,
  crypto: PayloadCrypto,
  env: AppEnv,
  media: ReturnType<typeof createMediaService>,
  memories: ReturnType<typeof createSourceMemoryPublisher>,
  sourceId: string,
  signal?: AbortSignal,
) {
  const source = await loadSource(db, sourceId)
  if (!source || source.status === 'rejected') return 'skipped' as const
  if (!hasTarget(source)) return pendingTelegramChoice(db, api, env, source, { sourceId })
  if (source.status === 'published') return sendSourceReceipt(db, api, env, source)
  if (!(await hasFullAccess(db, source))) return rejectSource(db, api, env, source, 'access_revoked')
  const event = decryptEvent(crypto, source.inbox)
  const mediaId = event.kind === 'media' && event.mediaKind !== 'video'
    ? await ingestSourceMedia(db, api, env, media, source, event, signal)
    : null
  const thumbnailMediaId = event.kind === 'media' && event.mediaKind === 'video'
    ? await ingestVideoThumbnail(db, api, env, media, source, event, signal)
    : null
  if (!(await hasFullAccess(db, source))) return rejectSource(db, api, env, source, 'access_revoked')
  const published = await publishSingle(db, memories, source.id, event, mediaId,
    event.kind === 'media' && event.mediaKind === 'video'
      ? telegramVideoReferenceWrite(crypto, source.id, event, thumbnailMediaId)
      : undefined)
  if (!published) return rejectSource(db, api, env, source, 'access_revoked')
  await sendSourceReceipt(db, api, env, { ...source, memoryId: published.memoryId })
}

/**
 * Handles an already accepted inbox record immediately while its durable outbox task remains the
 * fallback. The processor still owns authorization and idempotent completion.
 */
export function createTelegramImmediateInboxProcessor(options: {
  runtime: BackendRuntime
  api: TelegramApiPort
  crypto: PayloadCrypto
}) {
  const { prisma, env } = options.runtime
  const access = createPrismaFamilyAccess(prisma)
  const videoDelivery = new TelegramVideoDeliveryService(prisma, access, env.TELEGRAM_BOT_EXPECTED_USERNAME)
  return (inboxId: string) => processInbox(prisma, options.api, options.crypto, env, videoDelivery, inboxId)
}

function requiresInboxLock(event: TelegramInboundEvent) {
  return event.kind === 'denied_content' || isInviteStartEvent(event)
}

async function ingestVideoThumbnail(
  db: DbClient,
  api: TelegramApiPort,
  env: AppEnv,
  media: ReturnType<typeof createMediaService>,
  source: TargetedSource,
  event: TelegramMediaEvent,
  signal?: AbortSignal,
) {
  const thumbnail = event.thumbnail
  if (!thumbnail || !source.plannedMediaId) return null
  const existing = await db.mediaAsset.findFirst({
    where: { id: source.plannedMediaId, familyId: source.familyId, originalStatus: 'stored', deletedAt: null },
  })
  if (existing) return existing.id
  const download = await api.download(thumbnail.fileId, thumbnail.byteSize, signal)
  if (download.byteSize > env.TELEGRAM_FILE_MAX_BYTES) throw new TerminalTaskError('Telegram video thumbnail exceeds the MVP Bot API limit')
  const result = await media.ingestTelegram(scopeFor(source), {
    assetId: source.plannedMediaId,
    kind: 'photo',
    contentType: thumbnail.contentType,
    byteSize: download.byteSize,
    body: download.body,
  })
  return result.asset.id
}

async function processAlbum(
  db: DbClient,
  api: TelegramApiPort,
  crypto: PayloadCrypto,
  env: AppEnv,
  media: ReturnType<typeof createMediaService>,
  memories: ReturnType<typeof createSourceMemoryPublisher>,
  albumId: string,
  signal?: AbortSignal,
) {
  return withAlbumLock(env.DATABASE_URL, albumId, () => processAlbumLocked(db, api, crypto, env, media, memories, albumId, signal))
}

async function processAlbumLocked(
  db: DbClient,
  api: TelegramApiPort,
  crypto: PayloadCrypto,
  env: AppEnv,
  media: ReturnType<typeof createMediaService>,
  memories: ReturnType<typeof createSourceMemoryPublisher>,
  albumId: string,
  signal?: AbortSignal,
) {
  const album = await db.telegramAlbum.findUnique({ where: { id: albumId } })
  if (!album || album.status === 'rejected') return 'skipped' as const
  if (album.status === 'collecting' && album.readyAt.getTime() > Date.now()) return 'skipped' as const
  const rawSources = await db.telegramSource.findMany({
    where: { botId: album.botId, chatId: album.chatId, mediaGroupId: album.mediaGroupId },
    include: { inbox: true },
    orderBy: { messageId: 'asc' },
  })
  const untargeted = rawSources.find((source) => !hasTarget(source))
  if (untargeted) return pendingTelegramChoice(db, api, env, untargeted, { albumId })
  const sources = rawSources.filter(hasTarget)
  if (sources.length > 1 && sources.some((source) => source.familyId !== sources[0]!.familyId || source.childId !== sources[0]!.childId)) {
    return rejectAlbum(db, api, env, rawSources, album.id, 'mixed_target')
  }
  const pending = sources.filter((source) => source.status === 'accepted' || source.status === 'processing')

  if (album.status === 'published') {
    for (const source of pending) {
      const event = decryptEvent(crypto, source.inbox)
      if (event.kind !== 'media' || event.mediaKind !== 'photo' || sources.length > 10) {
        await rejectSource(db, api, env, source, 'late_mixed_album')
        continue
      }
      if (!(await hasFullAccess(db, source))) {
        await rejectSource(db, api, env, source, 'access_revoked')
        continue
      }
      const mediaId = await ingestSourceMedia(db, api, env, media, source, event, signal)
      const appended = await appendLatePhoto(db, memories, album.id, source.id, mediaId)
      if (!appended) throw new Error('Published Telegram album lost its memory link')
    }
    if (album.memoryId) await sendAlbumReceipt(db, api, env, album.id, album.chatId.toString(), album.memoryId)
    return
  }

  if (album.status === 'mixed') {
    for (const source of sources) {
      if (source.status === 'published') {
        await sendSourceReceipt(db, api, env, source)
        continue
      }
      if (source.status === 'rejected') continue
      const event = decryptEvent(crypto, source.inbox)
      if (event.kind !== 'media') throw new TerminalTaskError('Telegram album contains a non-media source')
      if (!(await hasFullAccess(db, source))) {
        await rejectSource(db, api, env, source, 'access_revoked')
        continue
      }
      const mediaId = event.mediaKind === 'video' ? null : await ingestSourceMedia(db, api, env, media, source, event, signal)
      const thumbnailMediaId = event.mediaKind === 'video' ? await ingestVideoThumbnail(db, api, env, media, source, event, signal) : null
      const published = await publishSingle(db, memories, source.id, event, mediaId,
        event.mediaKind === 'video' ? telegramVideoReferenceWrite(crypto, source.id, event, thumbnailMediaId) : undefined)
      if (published) await sendSourceReceipt(db, api, env, { ...source, memoryId: published.memoryId })
    }
    return
  }

  if (pending.length === 0) return 'skipped' as const

  const events = sources.map((source) => ({ source, event: decryptEvent(crypto, source.inbox) }))
  const mediaEvents = events.filter((entry): entry is typeof entry & { event: TelegramMediaEvent } => entry.event.kind === 'media')
  if (mediaEvents.length !== events.length) throw new TerminalTaskError('Telegram album contains a non-media source')
  const photoOnly = mediaEvents.every(({ event }) => event.mediaKind === 'photo')

  if (photoOnly && sources.length <= 10) {
    const mediaIds: string[] = []
    for (const { source, event } of mediaEvents) {
      if (!(await hasFullAccess(db, source))) return rejectAlbum(db, api, env, sources, album.id, 'access_revoked')
      mediaIds.push(await ingestSourceMedia(db, api, env, media, source, event, signal))
    }
    if (!(await hasFullAccess(db, sources[0]!))) return rejectAlbum(db, api, env, sources, album.id, 'access_revoked')
    const memoryId = await publishPhotoAlbum(db, memories, album.id, sources.map(({ id }) => id), mediaEvents.map(({ event }) => event), mediaIds)
    if (memoryId) await sendAlbumReceipt(db, api, env, album.id, album.chatId.toString(), memoryId)
    return
  }

  await db.telegramAlbum.update({ where: { id: album.id }, data: { status: 'mixed' } })
  for (const { source, event } of mediaEvents) {
    if (!(await hasFullAccess(db, source))) {
      await rejectSource(db, api, env, source, 'access_revoked')
      continue
    }
    const mediaId = event.mediaKind === 'video' ? null : await ingestSourceMedia(db, api, env, media, source, event, signal)
    const thumbnailMediaId = event.mediaKind === 'video' ? await ingestVideoThumbnail(db, api, env, media, source, event, signal) : null
    const published = await publishSingle(db, memories, source.id, event, mediaId,
      event.mediaKind === 'video' ? telegramVideoReferenceWrite(crypto, source.id, event, thumbnailMediaId) : undefined)
    if (published) await sendSourceReceipt(db, api, env, { ...source, memoryId: published.memoryId })
  }
}

async function ingestSourceMedia(
  db: DbClient,
  api: TelegramApiPort,
  env: AppEnv,
  media: ReturnType<typeof createMediaService>,
  source: TargetedSource,
  event: TelegramMediaEvent,
  signal?: AbortSignal,
) {
  if (!source) throw new TerminalTaskError('Telegram source disappeared')
  let plannedMediaId = source.plannedMediaId
  const planned = plannedMediaId ? await db.mediaAsset.findUnique({ where: { id: plannedMediaId } }) : null
  if (planned && (planned.originalStatus === 'failed' || planned.deletedAt)) {
    plannedMediaId = randomUUID()
    await db.telegramSource.update({ where: { id: source.id }, data: { plannedMediaId, mediaId: null, status: 'accepted' } })
  }
  const existing = plannedMediaId
    ? await db.mediaAsset.findFirst({ where: { id: plannedMediaId, originalStatus: 'stored', deletedAt: null } })
    : null
  if (existing) {
    await db.telegramSource.update({ where: { id: source.id }, data: { mediaId: existing.id, status: 'processing' } })
    return existing.id
  }
  if (!plannedMediaId) throw new TerminalTaskError('Telegram media source has no planned media id')
  if (event.fileSize !== null && event.fileSize > env.TELEGRAM_FILE_MAX_BYTES) {
    await db.telegramSource.update({ where: { id: source.id }, data: { status: 'rejected', rejectionCode: 'file_too_large' } })
    await api.sendMessage(source.chatId.toString(), 'Файл больше 20 МБ. Загрузите его через Mini App.', openButton(env))
    throw new TerminalTaskError('Telegram file exceeds the MVP Bot API limit')
  }
  const download = await api.download(event.fileId, event.fileSize, signal)
  if (download.byteSize > env.TELEGRAM_FILE_MAX_BYTES) throw new TerminalTaskError('Telegram file exceeds the MVP Bot API limit')
  const scope = scopeFor(source)
  try {
    const result = await media.ingestTelegram(scope, {
      assetId: plannedMediaId,
      kind: event.mediaKind,
      contentType: mediaContentType(event),
      byteSize: download.byteSize,
      body: download.body,
    })
    await db.telegramSource.update({ where: { id: source.id }, data: { mediaId: result.asset.id, status: 'processing' } })
    return result.asset.id
  } catch (error) {
    if (error instanceof MediaFailure && ['unsupported_media', 'invalid_file', 'quota_exceeded'].includes(error.kind)) {
      await db.telegramSource.update({ where: { id: source.id }, data: { status: 'rejected', rejectionCode: error.kind } })
      throw new TerminalTaskError('Telegram media was rejected by the private media lifecycle', { cause: error })
    }
    throw error
  }
}

async function publishSingle(
  db: DbClient,
  memories: ReturnType<typeof createSourceMemoryPublisher>,
  sourceId: string,
  event: TelegramInboundEvent,
  mediaId: string | null,
  afterWrite?: (tx: PrismaTransactionClient, memoryId: string) => Promise<void>,
) {
  const source = await db.telegramSource.findUnique({ where: { id: sourceId } })
  if (!source || !hasTarget(source)) return null
  if (source.status === 'published' && source.memoryId) return { memoryId: source.memoryId }
  const memoryId = await memories.publish(scopeFor(source), {
    id: source.plannedMemoryId,
    childId: source.childId,
    kind: memoryKind(event),
    body: event.kind === 'note' ? event.text : event.kind === 'media' ? event.caption : '',
    occurredAt: new Date('occurredAt' in event ? event.occurredAt : source.createdAt),
    mediaIds: mediaId ? [mediaId] : [],
    ...(memoryKind(event) === 'video' && !mediaId ? { externalAttachment: 'telegram-video' as const } : {}),
  }, async (tx, committedMemoryId) => {
    await afterWrite?.(tx, committedMemoryId)
    await tx.telegramSource.update({
      where: { id: source.id },
      data: { status: 'published', memoryId: committedMemoryId, mediaId },
    })
    await tx.telegramInbox.update({ where: { id: source.inboxId }, data: processedInboxData() })
  })
  return { memoryId }
}

function telegramVideoReferenceWrite(
  crypto: PayloadCrypto,
  sourceId: string,
  event: TelegramMediaEvent,
  thumbnailMediaId: string | null,
) {
  if (event.mediaKind !== 'video') throw new TerminalTaskError('Telegram video reference requires a video event')
  return async (tx: PrismaTransactionClient, memoryId: string) => {
    const encrypted = crypto.encrypt(event.fileId)
    const source = await tx.telegramSource.findUnique({
      where: { id: sourceId },
      select: { familyId: true, userId: true, chatId: true, messageId: true },
    })
    if (!source?.familyId) throw new TerminalTaskError('Telegram source lost its video target')
    const reference = await tx.telegramVideoReference.upsert({
      where: { sourceId },
      create: {
        sourceId,
        memoryId,
        familyId: source.familyId,
        fileIdCiphertext: Buffer.from(encrypted.ciphertext),
        encryptionIv: Buffer.from(encrypted.iv),
        encryptionAuthTag: Buffer.from(encrypted.authTag),
        fileUniqueId: event.fileUniqueId,
        width: event.width,
        height: event.height,
        durationMs: event.durationMs,
        thumbnailMediaId,
      },
      update: {},
    })
    await tx.telegramVideoDeliveryTarget.upsert({
      where: { referenceId_userId: { referenceId: reference.id, userId: source.userId } },
      create: {
        referenceId: reference.id,
        userId: source.userId,
        chatId: source.chatId,
        messageId: source.messageId,
        source: 'original',
      },
      update: {},
    })
  }
}

async function publishPhotoAlbum(
  db: DbClient,
  memories: ReturnType<typeof createSourceMemoryPublisher>,
  albumId: string,
  sourceIds: string[],
  events: TelegramMediaEvent[],
  mediaIds: string[],
) {
  const album = await db.telegramAlbum.findUnique({ where: { id: albumId } })
  const sources = await db.telegramSource.findMany({ where: { id: { in: sourceIds } }, orderBy: { messageId: 'asc' } })
  const first = sources[0]
  if (!album || !first || !hasTarget(first)) return null
  if (album.memoryId) return album.memoryId
  const memoryId = await memories.publish(scopeFor(first), {
    id: first.plannedMemoryId,
    childId: first.childId,
    kind: 'photo',
    body: events.find(({ caption }) => caption.length > 0)?.caption ?? '',
    occurredAt: new Date(events[0]!.occurredAt),
    mediaIds,
  }, async (tx, committedMemoryId) => {
    await tx.telegramSource.updateMany({
      where: { id: { in: sourceIds } },
      data: { status: 'published', memoryId: committedMemoryId },
    })
    await tx.telegramInbox.updateMany({ where: { source: { id: { in: sourceIds } } }, data: processedInboxData() })
    await tx.telegramAlbum.update({
      where: { id: albumId },
      data: { status: 'published', memoryId: committedMemoryId },
    })
  })
  return memoryId
}

async function appendLatePhoto(db: DbClient, memories: ReturnType<typeof createSourceMemoryPublisher>, albumId: string, sourceId: string, mediaId: string) {
  const album = await db.telegramAlbum.findUnique({ where: { id: albumId } })
  const source = await db.telegramSource.findUnique({ where: { id: sourceId } })
  if (!album?.memoryId || !source || !hasTarget(source)) return null
  const ordered = await db.telegramSource.findMany({
      where: { botId: album.botId, chatId: album.chatId, mediaGroupId: album.mediaGroupId, mediaId: { not: null } },
      orderBy: { messageId: 'asc' }, select: { id: true, mediaId: true },
    })
  if (ordered.length > 10) return null
  await memories.replaceOrderedMedia(
    scopeFor(source),
    album.memoryId,
    ordered.map(({ mediaId: id }) => id!),
    async (tx) => {
    await tx.telegramSource.update({ where: { id: sourceId }, data: { status: 'published', memoryId: album.memoryId, mediaId } })
    await tx.telegramInbox.update({ where: { id: source.inboxId }, data: processedInboxData() })
    },
  )
  return album.memoryId
}

async function rejectSource(db: DbClient, api: TelegramApiPort, env: AppEnv, source: NonNullable<Awaited<ReturnType<typeof loadSource>>>, code: string) {
  await db.telegramSource.update({ where: { id: source.id }, data: { status: 'rejected', rejectionCode: code } })
  await db.telegramInbox.update({ where: { id: source.inboxId }, data: processedInboxData() })
  await api.sendMessage(source.chatId.toString(), code === 'choice_expired'
    ? 'Время выбора семьи истекло. Отправьте материал заново.'
    : 'Материал не сохранён: доступ к семейному архиву недоступен.', openButton(env))
}

async function rejectAlbum(db: DbClient, api: TelegramApiPort, env: AppEnv, sources: Array<NonNullable<Awaited<ReturnType<typeof loadSource>>>>, albumId: string, code: string) {
  await db.telegramAlbum.update({ where: { id: albumId }, data: { status: 'rejected' } })
  for (const source of sources) await rejectSource(db, api, env, source, code)
}

function loadSource(db: DbClient, id: string) {
  return db.telegramSource.findUnique({ where: { id }, include: { inbox: true } })
}

function hasTarget<T extends { familyId: string | null; childId: string | null }>(source: T): source is T & { familyId: string; childId: string } {
  return !!source.familyId && !!source.childId
}

async function pendingTelegramChoice(
  db: DbClient, api: TelegramApiPort, env: AppEnv,
  source: NonNullable<Awaited<ReturnType<typeof loadSource>>>, task: { sourceId: string } | { albumId: string },
) {
  if (!source.choiceExpiresAt || source.choiceExpiresAt <= new Date()) {
    const chatId = await expireTelegramChoice(db, source.id, 'albumId' in task ? task.albumId : undefined)
    if (!chatId) return 'skipped' as const
    await api.sendMessage(chatId, 'Время выбора семьи истекло. Отправьте материал заново.', openButton(env))
    return 'done' as const
  }
  const candidates = readCandidates(source.choiceCandidates)
  if (!candidates.length) return rejectSource(db, api, env, source, 'choice_unavailable')
  for (let offset = 0; offset < candidates.length; offset += 100) {
    await api.sendMessage(source.chatId.toString(), 'Выберите семью для этой отправки. Выбор доступен 15 минут.', {
      buttons: candidates.slice(offset, offset + 100).map((candidate, pageIndex) => ({
        text: candidate.name, callbackData: choicePayload(source.id, offset + pageIndex),
      })),
    })
  }
  await db.taskOutbox.createMany({ data: [{ type: 'telegram:process', dedupeKey: `telegram-choice-expiry:${source.id}`,
    payload: task, scheduledFor: source.choiceExpiresAt }], skipDuplicates: true })
  return 'done' as const
}

async function hasFullAccess(db: DbClient, source: { familyId: string; userId: string }) {
  return (await db.familyMember.count({ where: {
    familyId: source.familyId, userId: source.userId, role: 'full', revokedAt: null, family: { status: 'active' },
  } })) === 1
}

function scopeFor(source: { familyId: string; userId: string }): FamilyScope {
  return { familyId: source.familyId, principal: { userId: source.userId, sessionId: 'telegram-adapter' } }
}

function decryptEvent(crypto: PayloadCrypto, row: { encryptedPayload: Uint8Array; encryptionIv: Uint8Array; encryptionAuthTag: Uint8Array }) {
  return crypto.decrypt<TelegramInboundEvent>({ ciphertext: row.encryptedPayload, iv: row.encryptionIv, authTag: row.encryptionAuthTag })
}

function memoryKind(event: TelegramInboundEvent): MemoryKind {
  if (event.kind === 'note') return 'note'
  if (event.kind === 'media') return event.mediaKind
  throw new TerminalTaskError('Telegram source event cannot become a memory')
}

function mediaContentType(event: TelegramMediaEvent) {
  if (event.mediaKind === 'photo') return 'image/jpeg' as const
  if (event.mediaKind === 'video') return 'video/mp4' as const
  return 'audio/ogg' as const
}

async function receipt(api: TelegramApiPort, env: AppEnv, chatId: string, memoryId: string, pending: boolean, familyName: string) {
  return api.sendMessage(
    chatId,
    pending
      ? `${savedFamilyText(familyName)} Оригинал сохранён. Готовим воспроизведение. Ответьте на это сообщение в течение 10 минут, чтобы добавить подпись; /cancel отменит запрос.`
      : savedFamilyText(familyName),
    pending ? { forceReply: true } : openButton(env, memoryId),
  )
}

async function sendSourceReceipt(
  db: DbClient,
  api: TelegramApiPort,
  env: AppEnv,
  source: { id: string; chatId: bigint; kind: string; familyId: string; userId: string; memoryId: string | null; receiptSentAt: Date | null },
) {
  if (source.receiptSentAt) return 'skipped' as const
  if (!source.memoryId) throw new Error('Published Telegram source lost its memory link')
  const needsCaption = source.kind === 'video' || source.kind === 'voice'
  const family = await db.family.findUniqueOrThrow({ where: { id: source.familyId }, select: { name: true } })
  const sent = await receipt(api, env, source.chatId.toString(), source.memoryId, needsCaption, family.name)
  if (needsCaption && sent && 'messageId' in sent) {
    const memory = await db.memory.findFirstOrThrow({ where: { id: source.memoryId, familyId: source.familyId, deletedAt: null }, select: { version: true } })
    await db.captionRequest.upsert({
      where: { chatId_promptMessageId: { chatId: source.chatId, promptMessageId: BigInt(sent.messageId) } },
      create: { familyId: source.familyId, userId: source.userId, memoryId: source.memoryId, chatId: source.chatId,
        promptMessageId: BigInt(sent.messageId), expectedVersion: memory.version, expiresAt: new Date(Date.now() + 10 * 60_000) },
      update: {},
    })
  }
  await db.telegramSource.updateMany({
    where: { id: source.id, receiptSentAt: null },
    data: { receiptSentAt: new Date() },
  })
}

async function sendAlbumReceipt(
  db: DbClient,
  api: TelegramApiPort,
  env: AppEnv,
  albumId: string,
  chatId: string,
  memoryId: string,
) {
  const album = await db.telegramAlbum.findUnique({ where: { id: albumId } })
  if (!album) return 'skipped' as const
  const where = {
    botId: album.botId,
    chatId: album.chatId,
    mediaGroupId: album.mediaGroupId,
    status: 'published' as const,
    receiptSentAt: null,
  }
  if ((await db.telegramSource.count({ where })) === 0) return 'skipped' as const
  const memory = await db.memory.findUniqueOrThrow({ where: { id: memoryId }, select: { family: { select: { name: true } } } })
  await receipt(api, env, chatId, memoryId, false, memory.family.name)
  await db.telegramSource.updateMany({ where, data: { receiptSentAt: new Date() } })
}

function commandText(command: string, cancelled = false) {
  if (command === 'start') return 'Отправьте сюда заметку, фото, видео или голосовое — материал автоматически сохранится в семейную ленту. Данные ребёнка заполняются в Mini App.'
  if (command === 'help') return 'Поддерживаются заметки, фото, видео и голосовые до 20 МБ. Подпись можно добавить в Mini App; удалить запись тоже можно там.'
  if (command === 'privacy') return 'Бот принимает материалы только в личном чате. Групповые сообщения не сохраняются и не анализируются.'
  if (command === 'cancel') return cancelled ? 'Добавление подписи отменено.' : 'Активного запроса подписи нет.'
  if (command === 'app') return 'Откройте семейную ленту в Mini App.'
  return 'Неизвестная команда. Используйте /help.'
}

function commandButtons(env: AppEnv, command: string, inviteToken: string | null) {
  if (!env.TELEGRAM_MINI_APP_URL || !['start', 'app'].includes(command)) return undefined
  const url = command === 'start' && inviteToken
    ? inviteMiniAppUrl(env.TELEGRAM_MINI_APP_URL, inviteToken)
    : env.TELEGRAM_MINI_APP_URL
  return { buttons: [{ text: command === 'start' && inviteToken ? 'Открыть приглашение' : 'Открыть ленту', webAppUrl: url }] }
}

async function inviteStartResponse(db: DbClient, env: AppEnv, rawToken: string) {
  const invite = await db.familyInvite.findUnique({
    where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
    include: { family: { select: { status: true } } },
  })
  if (!invite || invite.family.status !== 'active' || invite.revokedAt || invite.acceptedAt || invite.expiresAt <= new Date()) {
    return { text: 'Приглашение недействительно или уже истекло.', options: undefined }
  }
  return {
    text: 'Вас пригласили в семейную ленту memoLy.',
    options: commandButtons(env, 'start', rawToken),
  }
}

function isInviteStartEvent(event: TelegramInboundEvent) {
  return event.kind === 'command' && event.command === 'start' && inviteTokenFromStartArgument(event.argument) !== null
}

function inviteMiniAppUrl(miniAppUrl: string, rawToken: string) {
  const url = new URL(miniAppUrl)
  url.searchParams.set('tgWebAppStartParam', `invite_${rawToken}`)
  return url.toString()
}

function inviteTokenFromStartArgument(argument: string) {
  const match = /^invite_([A-Za-z0-9_-]{32,57})$/.exec(argument)
  return match?.[1] ?? null
}

function openButton(env: AppEnv, memoryId?: string) {
  if (!env.TELEGRAM_MINI_APP_URL) return undefined
  return openButtonFromUrl(env.TELEGRAM_MINI_APP_URL, memoryId)
}

function openButtonFromUrl(baseUrl: string, memoryId?: string) {
  return { buttons: [{ text: 'Открыть', webAppUrl: memoryId ? `${baseUrl}/memories/${memoryId}` : baseUrl }] }
}

function taskPayload(value: unknown) {
  if (typeof value !== 'object' || value === null) return {}
  const input = value as Record<string, unknown>
  return {
    inboxId: typeof input.inboxId === 'string' ? input.inboxId : undefined,
    sourceId: typeof input.sourceId === 'string' ? input.sourceId : undefined,
    albumId: typeof input.albumId === 'string' ? input.albumId : undefined,
  }
}

async function withAlbumLock<T>(databaseUrl: string, albumId: string, work: () => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  const lockName = `telegram-album:${albumId}`
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockName],
    )
    if (!result.rows[0]?.acquired) throw new Error('Telegram album is already being processed')
    return await work()
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]).catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

async function withInboxLock<T>(databaseUrl: string, inboxId: string, work: () => Promise<T>) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  const lockName = `telegram-inbox:${inboxId}`
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName])
    return await work()
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]).catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

function processedInboxData() {
  return {
    processedAt: new Date(),
    encryptedPayload: Buffer.alloc(0),
    encryptionIv: Buffer.alloc(0),
    encryptionAuthTag: Buffer.alloc(0),
  }
}
