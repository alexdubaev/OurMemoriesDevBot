import { randomUUID } from 'node:crypto'
import type { MaxSource } from '../../../generated/prisma/client'
import type { DbClient } from '../../../db'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { BackendRuntime } from '../../../runtime'
import { TerminalTaskError } from '../../../outbox'
import { createDetailedInviteStartResolver, createInviteStartResolver, createPrismaFamilyAccess, type DetailedInviteStartResolution, type FamilyScope } from '../../families'
import { createSourceMemoryPublisher } from '../../memories'
import type { MaxAcceptedEvent, MaxApiPort, MaxInboundEvent, MaxInboundAttachment, MaxResolvedMessage } from '../application/ports'
import { createMaxImageProcessor } from './process-image'
import { createMaxVideoProcessor } from './process-video'
import { createMaxVoiceProcessor } from './process-voice'
import type { MaxDownloadedMedia, MaxVideoStream } from './media-download'
import { resolveMaxTarget, chooseMaxTarget, expireMaxTarget } from './source-target'
import { parseChoicePayload, savedFamilyText } from '../../../bot-family-target'
import { assertMaxForwardBinding, reportMaxForwardDiagnostic, validateMaxForwardedMessage } from './forward-import'
import { MaxProviderError } from './max-api'

type PayloadCrypto = {
  decrypt<T>(payload: { ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }): T
}

const deniedText = 'Не удалось сохранить это сообщение в memoLy.'
const unsupportedMediaText = 'Получено. Медиа пока не поддерживается — отправьте текстовую заметку.'
const welcomeText = `Добро пожаловать в memoLy ❤️

Здесь живёт история вашей семьи: первые улыбки,
маленькие открытия и моменты, которые хочется сохранить.
📸 Фото, видео и заметки о ребёнке — в одном семейном альбоме,
доступном только его участникам.

🌱 Создаёте семейный альбом?
Добавляйте воспоминания, приглашайте родных и друзей
и выбирайте, какой доступ им предоставить.

❤️ Вас пригласили близкие?
Смотрите семейные воспоминания и оставляйте реакции —
будьте рядом, даже на расстоянии.

Нажмите кнопку ниже, чтобы открыть приложение
и начать вашу семейную историю.`
const returningWelcomeText = 'С возвращением в memoLy ❤️\nОткройте приложение, чтобы продолжить.'
const browserApprovalText = 'Откройте memoLy, чтобы подтвердить вход в браузере.'
const inviteGuidanceText = 'Приглашение получено. Откройте приложение memoLy, чтобы присоединиться.'
const invalidInviteText = 'Это приглашение недействительно или устарело. Откройте приложение memoLy, чтобы продолжить.'

export function createMaxTaskProcessor(options: {
  runtime: BackendRuntime
  crypto: PayloadCrypto
  resolveInviteStart?: (rawToken: string) => Promise<'active' | 'invalid'>
  resolveDetailedInviteStart?: (rawToken: string, maxSubject: string) => Promise<DetailedInviteStartResolution>
  api?: MaxApiPort
  media?: ReturnType<typeof import('../../media').createMediaService>
  download?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  videoDownload?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxVideoStream>
  processChannelLifecycle?: (inboxId: string, event: Extract<MaxAcceptedEvent, { kind: 'bot_added' | 'bot_removed' | 'bot_admin_permissions_changed' }>) => Promise<void>
  processChannelCallback?: (inboxId: string, event: Extract<MaxInboundEvent, { kind: 'family_choice' }>) => Promise<boolean>
  offerActorChannelConnection?: (input: { inboxId: string; actorSubject: string; actorUserId: string; familyId: string; chatId: bigint }) => Promise<boolean>
}): (payload: unknown, signal?: AbortSignal) => Promise<'done' | 'skipped'> {
  const { prisma } = options.runtime
  const resolveInviteStart = options.resolveInviteStart ?? createInviteStartResolver(prisma)
  const resolveDetailedInviteStart = options.resolveDetailedInviteStart ?? createDetailedInviteStartResolver(prisma)
  const access = createPrismaFamilyAccess(prisma)
  const publisher = createSourceMemoryPublisher(prisma, access)
  const imageProcessor = options.api && options.media && options.download
    ? createMaxImageProcessor({ runtime: options.runtime, api: options.api, media: options.media, download: options.download, videoDownload: options.videoDownload })
    : null
  const videoProcessor = options.api ? createMaxVideoProcessor({ runtime: options.runtime, api: options.api }) : null
  const voiceProcessor = options.api && options.media && options.download
    ? createMaxVoiceProcessor({ runtime: options.runtime, api: options.api, media: options.media, download: options.download })
    : null

  return async (payload, signal) => {
    const inboxId = taskPayload(payload)
    const inbox = await prisma.maxInbox.findUnique({ where: { id: inboxId }, include: { source: true } })
    if (!inbox) return 'skipped'
    if (inbox.status === 'processed' || inbox.processedAt) {
      await retryTerminalSourceCleanup(prisma, options.media, inbox.source)
      return 'skipped'
    }

    const decryptedEvent = options.crypto.decrypt<MaxAcceptedEvent>({
      ciphertext: inbox.encryptedPayload,
      iv: inbox.encryptionIv,
      authTag: inbox.encryptionAuthTag,
    })

    if (decryptedEvent.kind === 'bot_added' || decryptedEvent.kind === 'bot_removed' || decryptedEvent.kind === 'bot_admin_permissions_changed') {
      if (options.processChannelLifecycle) await options.processChannelLifecycle(inbox.id, decryptedEvent)
      else await prisma.maxInbox.updateMany({ where: { id: inbox.id, status: 'accepted' }, data: { status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } })
      return 'done'
    }

    if (decryptedEvent.kind === 'bot_started') {
      const event = decryptedEvent
      const token = inviteTokenFromPayload(event.payload)
      const browserApproval = isBrowserApprovalPayload(event.payload)
      let responseText = welcomeText
      let retainInviteContext = false
      let inviteResolution: DetailedInviteStartResolution | null = null
      if (browserApproval) {
        responseText = browserApprovalText
        retainInviteContext = true
      } else if (event.payload?.startsWith('invite_')) {
        if (!token) responseText = invalidInviteText
        else if (options.resolveInviteStart) {
          const resolution = await resolveInviteStart(token)
          responseText = resolution === 'active' ? inviteGuidanceText : invalidInviteText
          retainInviteContext = resolution === 'active'
        } else {
          const resolution = await resolveDetailedInviteStart(token, event.userId)
          inviteResolution = resolution
          responseText = inviteStartText(resolution)
          retainInviteContext = resolution.status === 'valid' || resolution.status === 'already_member'
        }
      }
      return await terminalInbox(prisma, inbox.id, 'welcome', event.userId, inbox.botId.toString(),
        (hasPriorInteraction) => {
          if (browserApproval) return { text: responseText, buttons: { kind: 'browser_approval' as const } }
          if (event.payload?.startsWith('invite_')) {
            if (inviteResolution?.status !== 'valid') return { text: responseText }
            return { text: hasPriorInteraction ? inviteReturningText(inviteResolution.familyName) : responseText,
              buttons: { kind: 'invite_welcome' as const, returning: hasPriorInteraction } }
          }
          return { text: hasPriorInteraction ? returningWelcomeText : responseText }
        },
        retainInviteContext) ? 'done' : 'skipped'
    }
    if (decryptedEvent.kind === 'family_choice') {
      const event = decryptedEvent
      if (event.payload.startsWith('max_channel:') && options.processChannelCallback &&
          await options.processChannelCallback(inbox.id, event)) {
        await options.api?.answerCallback?.(event.callbackId, 'Проверяем настройку канала…')
        return 'done'
      }
      const parsed = parseChoicePayload(event.payload)
      const result = parsed ? await chooseMaxTarget(prisma, parsed.sourceId, parsed.index, event.userId) : 'denied'
      await options.api?.answerCallback?.(event.callbackId, result === 'chosen' ? 'Семья выбрана. Сохраняем…' :
        result === 'already_chosen' ? 'Семья для этого сообщения уже выбрана.' :
        result === 'expired' ? 'Время выбора истекло. Отправьте материал заново.' : 'Этот выбор недоступен.')
      await prisma.maxInbox.updateMany({ where: { id: inbox.id, status: 'accepted' }, data: {
        status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
      } })
      return 'done'
    }

    let event = decryptedEvent
    if (event.kind === 'message_created' && event.isChannel && event.senderId === '0') {
      const channelChatId = BigInt(event.recipientId)
      const ownBackup = await prisma.maxMemoryBackup.findFirst({ where: {
        channelChatId, providerMessageId: event.messageId,
      }, select: { id: true } })
      if (ownBackup) {
        // The webhook arrived before the provider response was persisted. It is now
        // provably our own echo, so close the source without publishing a Memory.
        if (inbox.source) await suppressCorrelatedChannelEcho(prisma, inbox.id, inbox.source.id)
        return 'done'
      }
      const unresolvedBackup = await prisma.maxMemoryBackup.findFirst({ where: {
        channelChatId, state: { in: ['send_intent', 'ambiguous'] }, providerMessageId: null,
      }, select: { id: true } })
      if (unresolvedBackup) {
        // Preserve encrypted payload and accepted source. The outbox task retries after
        // send correlation is saved; no ambiguous message is attributed as an owner post.
        throw new Error('MAX channel message awaits outbound provider correlation')
      }
    }

    const source = inbox.source
    if (!source) throw new TerminalTaskError('MAX message inbox has no source')
    if (source.status !== 'accepted') {
      await retryTerminalSourceCleanup(prisma, options.media, source)
      return 'skipped'
    }

    let verifiedForward: MaxResolvedMessage | undefined
    let verifiedForwardChannelId: bigint | undefined
    let envelopeFallback = false
    if (event.forwardedFrom) {
      const forwardedFrom = event.forwardedFrom
      const denyForward = async (text = deniedText, suppressResponse = false) => {
        const denied = await deny(prisma, source, text, suppressResponse)
        if (denied) await retryTerminalSourceCleanup(prisma, options.media, source)
        return denied ? 'done' as const : 'skipped' as const
      }
      if (event.isChannel || event.senderId === '0') return denyForward(deniedText, true)
      if (!options.api?.getMessage) return denyForward()
      const targetResult = await resolveMaxTarget(prisma, source, new Date(), false)
      if (targetResult.kind === 'pending') return 'done'
      if (targetResult.kind === 'expired') {
        const result = await expireMaxTarget(prisma, source.id, source.inboxId, responseActor(event))
        if (result === 'done') await retryTerminalSourceCleanup(prisma, options.media, source)
        return result
      }
      if (targetResult.kind !== 'target') return denyForward()
      const forwardScope: FamilyScope = {
        familyId: targetResult.target.familyId,
        principal: { userId: targetResult.target.userId, sessionId: `max:${source.id}` },
      }
      try { await access.requireFull(forwardScope) } catch (error) {
        if (isExpectedAuthorizationFailure(error)) return denyForward()
        throw error
      }
      let identity: ReturnType<typeof validateMaxForwardedMessage>
      let forwardStage: 'provider_lookup' | 'channel_binding' = 'provider_lookup'
      try {
        verifiedForward = await options.api.getMessage(forwardedFrom.messageId, signal)
        identity = validateMaxForwardedMessage(verifiedForward, forwardedFrom.messageId)
        verifiedForwardChannelId = identity.channelId
        forwardStage = 'channel_binding'
        const binding = await prisma.maxChannelBinding.findUnique({ where: { chatId: identity.channelId }, select: { familyId: true } })
        if (binding?.familyId && binding.familyId !== targetResult.target.familyId) {
          await prisma.$transaction((tx) => assertMaxForwardBinding(tx, targetResult.target.familyId, identity.channelId))
        }
        if (!binding || binding.familyId === null) {
          if ((event.forwardedFrom.attachments?.length ?? 0) > 0) {
            const outer = await getVerifiedEnvelope(options.api, event, forwardedFrom.messageId, signal)
            if (outer) {
              verifiedForward = outer
              envelopeFallback = true
              throw new MaxProviderError(undefined, false, 403, 'forward_channel_unbound')
            }
          }
          const actorSubject = event.senderId
          const actorIdentity = actorSubject === source.senderSubject
            ? await prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: actorSubject } }, select: { userId: true } })
            : null
          if (actorIdentity?.userId === targetResult.target.userId && options.offerActorChannelConnection &&
              await options.offerActorChannelConnection({ inboxId: inbox.id, actorSubject, actorUserId: actorIdentity.userId,
                familyId: targetResult.target.familyId, chatId: identity.channelId })) {
            return await denyForward(deniedText, true)
          }
          if ((event.forwardedFrom.attachments?.length ?? 0) > 0 && await getVerifiedEnvelope(options.api, event, forwardedFrom.messageId, signal)) {
            throw new MaxProviderError(undefined, false, 403, 'forward_channel_unbound')
          }
          throw new MaxProviderError(undefined, false, 403, 'forward_channel_unbound')
        }
        await prisma.$transaction((tx) => assertMaxForwardBinding(tx, targetResult.target.familyId, identity.channelId))
      } catch (error) {
        if (signal?.aborted) throw error
        reportMaxForwardDiagnostic(forwardStage, error, { sourceId: source.id, inboxId: inbox.id,
          outerMessageId: event.messageId, originalMessageId: forwardedFrom.messageId })
        if (error instanceof MaxProviderError && error.retryable) throw error
        if (error instanceof MaxProviderError || isExpectedAuthorizationFailure(error)) {
          const outer = envelopeFallback ? verifiedForward : await getVerifiedEnvelope(options.api, event, forwardedFrom.messageId, signal)
          if (!outer) return denyForward()
          verifiedForward = outer
          verifiedForwardChannelId = undefined
          envelopeFallback = true
          const canonicalAttachments = outer.attachments.filter((attachment) => attachment.kind === 'image' || attachment.kind === 'video').map(toInboundAttachment)
          if (canonicalAttachments.length === 0 || outer.attachments.length !== canonicalAttachments.length) return denyForward()
          const timestamp = validForwardTimestamp(outer.forwardedFrom?.timestamp) ?? inbox.receivedAt.getTime()
          event = { ...event, forwardedFrom: undefined, text: null, occurredAt: new Date(timestamp).toISOString(), attachments: canonicalAttachments }
        }
        else throw error
      }
      const canonicalAttachments = envelopeFallback
        ? event.attachments ?? [] : verifiedForward!.attachments.map(toInboundAttachment)
      if (!envelopeFallback) {
        const timestamp = verifiedForward!.timestamp!
        event = { ...event, text: verifiedForward!.text ?? null, occurredAt: new Date(timestamp).toISOString(), attachments: canonicalAttachments }
      }
      if (canonicalAttachments.length === 0 && !isPublishableText(event.text)) {
        return denyForward()
      }
      let claim: Awaited<ReturnType<typeof claimMaxForwardSource>>
      try {
        claim = envelopeFallback
          ? await claimMaxEnvelopeSource(prisma, source, targetResult.target.familyId, forwardedFrom.messageId, canonicalAttachments, source.botId)
          : await claimMaxForwardSource(prisma, source.id, targetResult.target.familyId, identity!.channelId, forwardedFrom.messageId, canonicalAttachments)
        while (!envelopeFallback && claim.kind === 'cleanup') {
          const terminalOwner = await prisma.maxSource.findUnique({ where: { id: claim.ownerId } })
          await retryTerminalSourceCleanup(prisma, options.media, terminalOwner)
          claim = await claimMaxForwardSource(prisma, source.id, targetResult.target.familyId, identity!.channelId,
            forwardedFrom.messageId, canonicalAttachments)
        }
      } catch (error) {
        if (signal?.aborted) throw error
        reportMaxForwardDiagnostic('source_claim', error, { sourceId: source.id, inboxId: inbox.id,
          outerMessageId: event.messageId, originalMessageId: forwardedFrom.messageId })
        if (isExpectedAuthorizationFailure(error)) {
          return denyForward()
        }
        if (error instanceof MaxProviderError && !error.retryable) {
          return denyForward('Не удалось проверить исходную публикацию в MAX.')
        }
        throw error
      }
      if (claim.kind === 'duplicate') return await completeForwardDuplicate(prisma, options.media, source, event.senderId) ? 'done' : 'skipped'
      if (claim.kind === 'published') return 'skipped'
    }

    const hasAttachments = (event.attachments?.length ?? (event.hasAttachments ? 1 : 0)) > 0
    if (hasAttachments) {
      if (videoProcessor && event.attachments?.length === 1 && event.attachments[0]?.kind === 'video') {
        return videoProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal,
          ...(verifiedForward ? { verifiedMessage: verifiedForward, verifiedChannelId: verifiedForwardChannelId } : {}) })
      }
      if (voiceProcessor && event.attachments?.length === 1 && event.attachments[0]?.kind === 'voice') {
        return voiceProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal,
          ...(verifiedForward ? { verifiedMessage: verifiedForward, verifiedChannelId: verifiedForwardChannelId } : {}) })
      }
      if (imageProcessor && source) return imageProcessor({ inboxId: inbox.id, sourceId: source.id, event, signal,
        ...(verifiedForward ? { verifiedMessage: verifiedForward, verifiedChannelId: verifiedForwardChannelId } : {}) })
      return await terminalSource(prisma, source, 'unsupported_media', responseActor(event), unsupportedMediaText) ? 'done' : 'skipped'
    }

    if (!isPublishableText(event.text)) {
      return await deny(prisma, source, undefined, event.isChannel === true) ? 'done' : 'skipped'
    }
    const text = event.text

    const targetResult = await resolveMaxTarget(prisma, source, new Date(), event.isChannel === true)
    if (targetResult.kind === 'pending') return 'done'
    if (targetResult.kind === 'expired') return expireMaxTarget(prisma, source.id, source.inboxId, responseActor(event))
    if (targetResult.kind !== 'target') return await deny(prisma, source,
      'Материал не сохранён: нет семьи с правом публикации и профилем ребёнка.', event.isChannel === true) ? 'done' : 'skipped'
    const admission = targetResult.target

    const scope: FamilyScope = {
      familyId: admission.familyId,
      principal: { userId: admission.userId, sessionId: `max:${source.id}` },
    }
    const publish = () => publisher.publish(scope, {
      id: source.plannedMemoryId,
      childId: admission.childId,
      kind: 'note',
      body: text,
      occurredAt: new Date(event.occurredAt),
      sourcePublishedAt: new Date(event.occurredAt),
      mediaIds: [],
    }, async (tx, memoryId) => {
        if (verifiedForwardChannelId !== undefined) await assertMaxForwardBinding(tx, admission.familyId, verifiedForwardChannelId)
        const family = await tx.family.findUniqueOrThrow({ where: { id: admission.familyId }, select: { name: true } })
        await tx.maxSource.update({ where: { id: source.id }, data: {
          status: 'published', memoryId, userId: admission.userId, familyId: admission.familyId, childId: admission.childId,
        } })
        await markInboxProcessed(tx, inbox.id)
      if (!event.isChannel) await createResponseAndTask(tx, {
        inboxId: inbox.id, destinationUserId: source.senderSubject, kind: 'saved', text: savedFamilyText(family.name),
      })
    })
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          await publish()
          break
        } catch (error) {
          if (!isUniqueConstraint(error) || attempt >= 2) throw error
        }
      }
      return 'done'
    } catch (error) {
      if (isExpectedAuthorizationFailure(error)) {
        await deny(prisma, source, undefined, event.isChannel === true)
        return 'done'
      }
      throw error
    }
  }
}

async function claimMaxForwardSource(
  db: DbClient,
  sourceId: string,
  familyId: string,
  channelId: bigint,
  originalMessageId: string,
  attachments: MaxInboundAttachment[],
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`max-forward:${familyId}:${channelId}:${originalMessageId}`}, 0))`
    await assertMaxForwardBinding(tx, familyId, channelId)
    const liveSource = await tx.maxSource.findFirst({ where: {
      id: { not: sourceId }, familyId, recipientId: channelId, messageId: originalMessageId,
      status: { in: ['accepted', 'published'] },
    }, select: { status: true } })
    if (liveSource?.status === 'published') return { kind: 'duplicate' as const }
    if (liveSource?.status === 'accepted') throw new MaxProviderError(undefined, true, 503, 'forward_claim_pending')

    const canonicalOwner = await tx.maxSource.findFirst({ where: {
      id: { not: sourceId }, familyId, originalChannelId: channelId, originalMessageId,
    }, select: { id: true, status: true } })
    if (canonicalOwner?.status === 'published') return { kind: 'duplicate' as const }
    if (canonicalOwner?.status === 'accepted') throw new MaxProviderError(undefined, true, 503, 'forward_claim_pending')
    if (canonicalOwner) return { kind: 'cleanup' as const, ownerId: canonicalOwner.id }

    const currentRows = await tx.maxSourceAttachment.findMany({ where: { sourceId }, orderBy: { position: 'asc' }, select: {
      position: true, providerKind: true, providerAttachmentId: true,
    } })
    const staged = attachments.filter((attachment) => attachment.kind !== 'video' || attachments.length > 1)
    if (currentRows.length > 0 && (currentRows.length !== staged.length || currentRows.some((row, index) => {
      const attachment = staged[index]!
      const kind = attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'video' : 'file'
      return row.position !== index || row.providerKind !== kind || row.providerAttachmentId !== attachment.providerAttachmentId
    }))) throw new MaxProviderError(undefined, false, 400, 'forward_attachment_mismatch')
    const changed = await tx.maxSource.updateMany({ where: { id: sourceId, status: 'accepted' }, data: {
      familyId, originalChannelId: channelId, originalMessageId,
    } })
    if (changed.count !== 1) {
      const current = await tx.maxSource.findUnique({ where: { id: sourceId }, select: { status: true, familyId: true, originalChannelId: true, originalMessageId: true } })
      if (current?.status === 'published') return { kind: 'published' as const }
      if (current?.status === 'accepted' && current.familyId === familyId && current.originalChannelId === channelId && current.originalMessageId === originalMessageId) return { kind: 'claimed' as const }
      throw new MaxProviderError(undefined, true, 503, 'forward_claim_lost')
    }
    if (currentRows.length === 0 && staged.length > 0) await tx.maxSourceAttachment.createMany({ data: staged.map((attachment, position) => ({
      sourceId, position,
      providerKind: attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'video' : 'file',
      providerAttachmentId: attachment.providerAttachmentId,
      plannedMediaId: randomUUID(),
    })) })
    return { kind: 'claimed' as const }
  })
}

async function claimMaxEnvelopeSource(db: DbClient, source: MaxSource, familyId: string, originalMessageId: string,
  attachments: MaxInboundAttachment[], botId: bigint) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`max-envelope:${botId}:${familyId}:${source.senderSubject}:${originalMessageId}`}, 0))`
    const owner = await tx.maxSource.findFirst({ where: { id: { not: source.id }, botId, familyId, senderSubject: source.senderSubject,
      originalChannelId: null, originalMessageId, status: { in: ['accepted', 'published'] } }, select: { id: true, status: true } })
    if (owner) {
      const ownerRows = await tx.maxSourceAttachment.findMany({ where: { sourceId: owner.id }, orderBy: { position: 'asc' }, select: { providerKind: true, providerAttachmentId: true } })
      if (!sameEnvelopeAttachments(ownerRows, attachments)) throw new MaxProviderError(undefined, false, 400, 'envelope_attachment_mismatch')
      if (owner.status === 'published') return { kind: 'duplicate' as const }
      throw new MaxProviderError(undefined, true, 503, 'envelope_claim_pending')
    }
    const currentRows = await tx.maxSourceAttachment.findMany({ where: { sourceId: source.id }, orderBy: { position: 'asc' }, select: { position: true, providerKind: true, providerAttachmentId: true } })
    if (currentRows.length > 0 && !sameEnvelopeAttachments(currentRows, attachments)) throw new MaxProviderError(undefined, false, 400, 'envelope_attachment_mismatch')
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      familyId, originalChannelId: null, originalMessageId,
    } })
    if (changed.count !== 1) {
      const current = await tx.maxSource.findUnique({ where: { id: source.id }, select: { status: true, familyId: true, originalChannelId: true, originalMessageId: true } })
      if (current?.status === 'published') return { kind: 'published' as const }
      if (current?.status === 'accepted' && current.familyId === familyId && current.originalChannelId === null && current.originalMessageId === originalMessageId) return { kind: 'claimed' as const }
      throw new MaxProviderError(undefined, true, 503, 'envelope_claim_lost')
    }
    if (currentRows.length === 0) await tx.maxSourceAttachment.createMany({ data: attachments.map((attachment, position) => ({
      sourceId: source.id, position, providerKind: attachment.kind === 'image' ? 'image' : 'video',
      providerAttachmentId: attachment.providerAttachmentId, plannedMediaId: randomUUID(),
    })) })
    return { kind: 'claimed' as const }
  })
}

function sameEnvelopeAttachments(rows: Array<{ providerKind: string; providerAttachmentId: string }>, attachments: MaxInboundAttachment[]) {
  return rows.length === attachments.length && rows.every((row, index) => {
    const attachment = attachments[index]!
    return row.providerKind === attachment.kind && row.providerAttachmentId === attachment.providerAttachmentId
  })
}

async function getVerifiedEnvelope(api: MaxApiPort | undefined, event: Extract<MaxInboundEvent, { kind: 'message_created' }>, originalMessageId: string, signal?: AbortSignal) {
  if (!api?.getMessage || event.isChannel || event.senderId === '0') return null
  try {
    const outer = await api.getMessage(event.messageId, signal)
    const attachments = outer.forwardedAttachments
    if (outer.messageId !== event.messageId || outer.senderId !== event.senderId || outer.recipientType !== 'dialog' || outer.recipientId !== event.recipientId ||
        outer.forwardedFrom?.messageId !== originalMessageId || !attachments?.length || attachments.some((attachment) => attachment.kind !== 'image' && attachment.kind !== 'video') ||
        new Set(attachments.map((attachment) => attachment.providerAttachmentId)).size !== attachments.length) return null
    const ingress = event.forwardedFrom?.attachments ?? []
    if (ingress.length > 0 && (ingress.length !== attachments.length || ingress.some((item, index) => item.kind !== attachments[index]!.kind || item.providerAttachmentId !== attachments[index]!.providerAttachmentId))) return null
    return { ...outer, attachments }
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof MaxProviderError && error.retryable) throw error
    return null
  }
}

function validForwardTimestamp(timestamp: number | undefined, now = Date.now()) {
  return timestamp !== undefined && Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8_640_000_000_000_000 && timestamp <= now + 5 * 60_000
    ? timestamp : null
}

async function completeForwardDuplicate(db: DbClient, media: ReturnType<typeof import('../../media').createMediaService> | undefined, source: MaxSource, actorId: string) {
  const staged = await db.maxSourceAttachment.findMany({ where: { sourceId: source.id }, select: { plannedMediaId: true } })
  if (staged.length > 0) {
    if (!media) throw new MaxProviderError(undefined, true, 503, 'forward_duplicate_cleanup_pending')
    await media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: staged.map((row) => row.plannedMediaId) })
  }
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: 'denied', rejectionCode: 'duplicate', originalChannelId: null,
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
    if (BigInt(actorId) > 0n) await createResponseAndTask(tx, {
      inboxId: source.inboxId, destinationUserId: actorId, kind: 'saved', text: 'Эта публикация уже сохранена в семейной ленте.',
    })
    return true
  })
}

function toInboundAttachment(attachment: MaxResolvedMessage['attachments'][number]): MaxInboundAttachment {
  if (attachment.kind === 'image') return { kind: 'image', providerAttachmentId: attachment.providerAttachmentId }
  if (attachment.kind === 'voice') return { kind: 'voice', providerAttachmentId: attachment.providerAttachmentId, url: attachment.url }
  if (attachment.kind === 'video') return { kind: 'video', providerAttachmentId: attachment.providerAttachmentId,
    durationSeconds: attachment.inboundDurationSeconds, width: attachment.width, height: attachment.height }
  return { kind: 'file', providerAttachmentId: attachment.providerAttachmentId, filename: attachment.filename, declaredSize: attachment.declaredSize }
}

async function suppressCorrelatedChannelEcho(db: DbClient, inboxId: string, sourceId: string) {
  await db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: sourceId, inboxId, status: 'accepted' }, data: {
      status: 'denied', rejectionCode: 'self_loop',
    } })
    if (changed.count === 1) await markInboxProcessed(tx, inboxId)
  })
}

async function retryTerminalSourceCleanup(
  db: DbClient,
  media: ReturnType<typeof import('../../media').createMediaService> | undefined,
  source: MaxSource | null,
) {
  if (!source) return
  const stored = await db.maxSource.findUnique({ where: { id: source.id }, include: { attachments: { select: { plannedMediaId: true } } } })
  if (!stored || (stored.status !== 'denied' && stored.status !== 'unsupported_media')) return
  if (stored.attachments.length > 0 && media) {
    await media.discardTrustedSourceAssets({ sourceKind: 'max', assetIds: stored.attachments.map(({ plannedMediaId }) => plannedMediaId) })
  }
  if (stored.attachments.length > 0 && !media && stored.originalChannelId !== null) throw new MaxProviderError(undefined, true, 503, 'forward_cleanup_pending')
  if (stored.originalChannelId !== null) await db.maxSource.updateMany({ where: { id: source.id, status: stored.status }, data: { originalChannelId: null } })
}

function inviteTokenFromPayload(payload: string | null) {
  if (!payload?.startsWith('invite_')) return null
  const token = payload.slice('invite_'.length)
  return /^[A-Za-z0-9_-]{32,121}$/.test(token) && payload.length <= 128 ? token : null
}

export function inviteStartText(result: DetailedInviteStartResolution, returning = false) {
  switch (result.status) {
    case 'valid': return returning ? inviteReturningText(result.familyName) : inviteWelcomeText(result.familyName)
    case 'already_member': return 'Вы уже состоите в этой семье. Откройте memoLy.'
    case 'expired': return 'Срок действия приглашения истёк.'
    case 'revoked': return 'Это приглашение больше не действует.'
    case 'used': return 'Это приглашение уже использовано.'
    case 'invalid': return 'Не удалось найти действующее приглашение.'
  }
}

function inviteWelcomeText(familyName: string) {
  const safeName = safeFamilyName(familyName)
  return `Добро пожаловать в memoLy ❤️

Здесь живёт история вашей семьи: первые улыбки,
маленькие открытия и моменты, которые хочется сохранить.
📸 Фото, видео и заметки о ребёнке — в одном семейном альбоме,
доступном только его участникам.

🌱 Создаёте семейный альбом?
Добавляйте воспоминания, приглашайте родных и друзей
и выбирайте, какой доступ им предоставить.

❤️ Вас пригласили близкие?
Смотрите семейные воспоминания и оставляйте реакции —
будьте рядом, даже на расстоянии.

Вас пригласили в семью „${safeName}“ 💌

Нажмите кнопку ниже, чтобы посмотреть приглашение
и присоединиться к семейному альбому.`
}

function inviteReturningText(familyName: string) {
  return `Вас пригласили в семью „${safeFamilyName(familyName)}“ 💌\nОткройте приглашение, чтобы продолжить.`
}

function safeFamilyName(familyName: string) {
  return familyName.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'вашу семью'
}

function taskPayload(payload: unknown): string {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || typeof payload.inboxId !== 'string' || !isUuid(payload.inboxId)) {
    throw new TerminalTaskError('MAX task payload is invalid')
  }
  return payload.inboxId
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function isUuid(input: string) {
  return input !== '00000000-0000-0000-0000-000000000000'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
}

function isPublishableText(text: string | null): text is string {
  return text !== null && text.trim().length > 0 && [...text].length <= 8_000
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002'
}

function isExpectedAuthorizationFailure(error: unknown) {
  if (!(error instanceof Error) || (error.name !== 'FamilyFailure' && error.name !== 'MemoryFailure')) return false
  const kind = (error as { kind?: unknown }).kind
  return kind === 'not_found' || kind === 'forbidden'
}

async function deny(db: DbClient, source: MaxSource, text = deniedText, suppressResponse = false) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: 'denied', rejectionCode: 'denied',
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
      if (!suppressResponse) await createResponseAndTask(tx, {
        inboxId: source.inboxId, destinationUserId: source.senderSubject, kind: 'denied', text,
      })
    return true
  })
}

async function terminalSource(db: DbClient, source: MaxSource, kind: 'unsupported_media', destinationUserId: string, text: string) {
  return db.$transaction(async (tx) => {
    const changed = await tx.maxSource.updateMany({ where: { id: source.id, status: 'accepted' }, data: {
      status: kind, rejectionCode: kind,
    } })
    if (changed.count !== 1) return false
    await markInboxProcessed(tx, source.inboxId)
    if (BigInt(destinationUserId) > 0n) await createResponseAndTask(tx, { inboxId: source.inboxId, destinationUserId, kind, text })
    return true
  })
}

async function terminalInbox(
  db: DbClient,
  inboxId: string,
  kind: 'welcome',
  destinationUserId: string,
  botId: string,
  responseForInteraction: (hasPriorInteraction: boolean) => { text: string; buttons?: { kind: 'browser_approval' } | { kind: 'invite_welcome'; returning: boolean } },
  retainInviteContext: boolean,
) {
  return db.$transaction(async (tx) => {
    const browserApproval = responseForInteraction(false).buttons?.kind === 'browser_approval'
    if (!browserApproval) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`max-bot-start:${botId}:${destinationUserId}`}, 0))`
    }
    const [previous] = browserApproval ? [{ prior: false }] : await tx.$queryRaw<Array<{ prior: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM max_outgoing_responses response
        JOIN max_inbox inbox ON inbox.id = response.inbox_id
        WHERE response.destination_user_id = ${BigInt(destinationUserId)}
          AND response.kind = 'welcome'
          AND response.buttons IS DISTINCT FROM '{"kind":"browser_approval"}'::jsonb
          AND inbox.bot_id = ${BigInt(botId)}
          AND inbox.event_kind = 'bot_started'
          AND inbox.id <> ${inboxId}::uuid
      ) AS prior
    `
    const changed = await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: {
      status: 'processed', processedAt: new Date(),
      ...(!retainInviteContext ? { encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0) } : {}),
    } })
    if (changed.count !== 1) return false
    const selected = responseForInteraction(Boolean(previous?.prior))
    await createResponseAndTask(tx, { inboxId, destinationUserId, kind, text: selected.text, ...(selected.buttons ? { buttons: selected.buttons } : {}) })
    return true
  })
}

function isBrowserApprovalPayload(payload: string | null): payload is string {
  return typeof payload === 'string' && /^browser_\d{24}$/.test(payload)
}

async function markInboxProcessed(tx: PrismaTransactionClient, inboxId: string) {
  const changed = await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: {
    status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
  } })
  return changed.count === 1
}

async function createResponseAndTask(
  tx: PrismaTransactionClient,
  input: { inboxId: string; destinationUserId: string; kind: 'saved' | 'denied' | 'unsupported_media' | 'welcome'; text: string; buttons?: { kind: 'browser_approval' } | { kind: 'invite_welcome'; returning: boolean } },
) {
  const response = await tx.maxOutgoingResponse.upsert({
    where: { inboxId_kind: { inboxId: input.inboxId, kind: input.kind } },
    create: { inboxId: input.inboxId, destinationUserId: BigInt(input.destinationUserId), kind: input.kind, text: input.text, ...(input.buttons ? { buttons: input.buttons } : {}) },
    update: { destinationUserId: BigInt(input.destinationUserId), text: input.text, ...(input.buttons ? { buttons: input.buttons } : {}) },
    select: { id: true },
  })
  await tx.taskOutbox.createMany({ data: [{
    type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date(),
  }], skipDuplicates: true })
}

function responseActor(event: Extract<MaxInboundEvent, { kind: 'message_created' }>) {
  return event.isChannel ? '0' : event.senderId
}
