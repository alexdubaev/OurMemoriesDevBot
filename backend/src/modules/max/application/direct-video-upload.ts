import { createHash, randomUUID } from 'node:crypto'

import type { MemoryDto } from '@web-app-demo/contracts'

import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyAccess, FamilyScope } from '../../families'
import type { SourceMemoryInput } from '../../memories/infrastructure/source-memory-publisher'
import type {
  MaxApiPort,
  MaxDirectUploadRepository,
  MaxVideoUploadCapability,
  MaxVideoUploadSession,
} from './ports'

const maxFileBytes = 250 * 1024 * 1024
const reservationTtlMs = 15 * 60 * 1_000
const attachmentReadyAttempts = 3

export type DirectVideoUploadReserveInput = {
  childId: string
  body: string
  occurredAt: string
  fileName: string
  fileSize: number
  mimeType: string
  idempotencyKey: string
}

export type DirectVideoUploadReserveResult = {
  state: 'reserved' | 'existing'
  sessionId: string
  expiresAt: string
  uploadUrl?: string
  uploadToken?: string
}

export type DirectVideoUploadFinalizeResult = {
  state: 'finalized' | 'processing' | 'expired' | 'failed'
  sessionId: string
  memoryId?: string
  memory?: MemoryDto
  retryable?: boolean
  code?: string
}

type SourceMemoryPublisher = {
  publish(
    scope: FamilyScope,
    input: SourceMemoryInput,
    afterWrite?: (tx: PrismaTransactionClient, memoryId: string) => Promise<void>,
  ): Promise<string>
}

type MemoryReader = {
  get(scope: FamilyScope, memoryId: string): Promise<MemoryDto>
}

export class MaxDirectUploadFailure extends Error {
  constructor(
    public readonly kind: 'not_found' | 'forbidden' | 'invalid_input' | 'conflict' | 'retryable',
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'MaxDirectUploadFailure'
  }
}

export function createMaxDirectVideoUploadService(options: {
  access: FamilyAccess
  api: MaxApiPort
  repository: MaxDirectUploadRepository
  publisher: SourceMemoryPublisher
  memoryReader?: MemoryReader
  now?: () => Date
  reservationTtlMs?: number
}) {
  const now = options.now ?? (() => new Date())
  const ttl = options.reservationTtlMs ?? reservationTtlMs
  const sentProviderMessageIds = new Map<string, string>()
  const pendingCapabilities = new Map<string, Promise<MaxVideoUploadCapability>>()

  const createOrReuseCapability = (sessionId: string) => {
    const existing = pendingCapabilities.get(sessionId)
    if (existing) return existing
    const pending = Promise.resolve()
      .then(() => options.api.createVideoUpload())
      .catch(() => {
        pendingCapabilities.delete(sessionId)
        throw new MaxDirectUploadFailure('retryable', 'Не удалось подготовить загрузку видео', 'upload_capability_unavailable')
      })
    pendingCapabilities.set(sessionId, pending)
    return pending
  }

  const persistCapability = async (session: MaxVideoUploadSession, capability: MaxVideoUploadCapability) => {
    if (!capability.token) {
      pendingCapabilities.delete(session.id)
      throw new MaxDirectUploadFailure('retryable', 'Не удалось подготовить загрузку видео', 'upload_capability_unavailable')
    }
    try {
      await options.repository.update(session, { providerUploadToken: capability.token })
      pendingCapabilities.delete(session.id)
    } catch {
      throw new MaxDirectUploadFailure('retryable', 'Не удалось подготовить загрузку видео', 'upload_capability_unavailable')
    }
  }

  return {
    async reserve(scope: FamilyScope, input: DirectVideoUploadReserveInput): Promise<DirectVideoUploadReserveResult> {
      await options.access.requireFull(scope)
      validateReservation(input, now())
      await assertChild(options.repository, scope, input.childId)
      const occurredAt = new Date(input.occurredAt)
      const idempotencyFingerprint = fingerprint(input)
      let reserved
      try {
        reserved = await options.repository.reserve({
          familyId: scope.familyId,
          authorId: scope.principal.userId,
          childId: input.childId,
          plannedMemoryId: randomUUID(),
          body: input.body.trim(),
          occurredAt,
          idempotencyFingerprint,
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(now().getTime() + ttl),
          now: now(),
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('idempotency')) {
          throw new MaxDirectUploadFailure('conflict', 'Этот ключ уже использован для другого видео', 'idempotency_conflict')
        }
        throw error
      }

      if (!reserved.created) {
        if (!reserved.session.providerUploadToken) {
          const capability = await createOrReuseCapability(reserved.session.id)
          await persistCapability(reserved.session, capability)
          return {
            state: 'reserved',
            sessionId: reserved.session.id,
            expiresAt: reserved.session.expiresAt.toISOString(),
            uploadUrl: capability.url,
            uploadToken: capability.token,
          }
        }
        return {
          state: 'existing',
          sessionId: reserved.session.id,
          expiresAt: reserved.session.expiresAt.toISOString(),
        }
      }

      // The durable row is written before this provider call. The capability is intentionally
      // returned only as the ephemeral browser operation result and is never included in errors.
      const capability = await createOrReuseCapability(reserved.session.id)
      await persistCapability(reserved.session, capability)
      return {
        state: 'reserved',
        sessionId: reserved.session.id,
        expiresAt: reserved.session.expiresAt.toISOString(),
        uploadUrl: capability.url,
        ...(capability.token ? { uploadToken: capability.token } : {}),
      }
    },

    async finalize(scope: FamilyScope, sessionId: string, uploadToken?: string): Promise<DirectVideoUploadFinalizeResult> {
      await options.access.requireFull(scope)
      const initial = await options.repository.find(scope.familyId, sessionId)
      if (!initial) throw new MaxDirectUploadFailure('not_found', 'Сессия загрузки не найдена')
      if (initial.familyId !== scope.familyId || initial.authorId !== scope.principal.userId) {
        throw new MaxDirectUploadFailure('forbidden', 'Сессия загрузки недоступна')
      }
      if (initial.state === 'finalized') return finalizedResult(scope, initial, options.memoryReader)
      const currentTime = now()
      if (initial.expiresAt <= currentTime) {
        if (initial.state !== 'expired') await options.repository.update(initial, { state: 'expired', lastErrorCode: 'upload_expired' })
        return { state: 'expired', sessionId: initial.id, retryable: false, code: 'upload_expired' }
      }
      const claimed = await options.repository.claim(scope.familyId, sessionId, currentTime)
      if (!claimed) throw new MaxDirectUploadFailure('not_found', 'Сессия загрузки не найдена')
      if (!claimed.claimed) {
        if (claimed.session.state === 'finalized') return finalizedResult(scope, claimed.session, options.memoryReader)
        return { state: 'processing', sessionId: claimed.session.id, retryable: true, code: 'finalize_in_progress' }
      }
      const session = claimed.session
      if (session.familyId !== scope.familyId || session.authorId !== scope.principal.userId) {
        throw new MaxDirectUploadFailure('forbidden', 'Сессия загрузки недоступна')
      }
      await assertChild(options.repository, scope, session.childId)
      if (uploadToken !== undefined && session.providerUploadToken !== null && uploadToken !== session.providerUploadToken) {
        throw new MaxDirectUploadFailure('forbidden', 'Сессия загрузки недоступна')
      }
      if (session.expiresAt <= now()) {
        await options.repository.update(session, { state: 'expired', lastErrorCode: 'upload_expired' })
        return { state: 'expired', sessionId: session.id, retryable: false, code: 'upload_expired' }
      }

      try {
        let providerMessageId = session.providerMessageId ?? sentProviderMessageIds.get(session.id) ?? null
        const existingOutbound = options.repository.findOutboundSource
          ? await options.repository.findOutboundSource(session.id, scope.familyId)
          : null
        if (!providerMessageId && existingOutbound) providerMessageId = existingOutbound.messageId
        if (!providerMessageId) {
          const token = session.providerUploadToken
          if (!token) throw new MaxDirectUploadFailure('retryable', 'Загрузка ещё не готова к публикации', 'upload_not_ready')
          const sent = await sendVideoMessageWithRetry(options.api, {
            userId: await recipientId(options.repository, scope),
            text: session.body,
            uploadToken: token,
          })
          providerMessageId = sent.messageId
          sentProviderMessageIds.set(session.id, providerMessageId)
          await options.repository.update(session, { providerMessageId, state: 'message_sent' })
        }

        const providerMessage = await resolveMessage(options.api, providerMessageId)
        const video = providerMessage.attachments[0]
        if (providerMessage.attachments.length !== 1 || !video || video.kind !== 'video' || providerMessage.messageId !== providerMessageId) {
          throw new MaxDirectUploadFailure('retryable', 'Видео в MAX ещё не готово', 'attachment_not_ready')
        }
        if (session.expiresAt <= now()) {
          await options.repository.update(session, { state: 'expired', lastErrorCode: 'upload_expired' })
          return { state: 'expired', sessionId: session.id, retryable: false, code: 'upload_expired' }
        }
        const outbound = existingOutbound ?? await options.repository.createOutboundSource({
          uploadSessionId: session.id,
          familyId: scope.familyId,
          recipientId: await recipientId(options.repository, scope),
          messageId: providerMessageId,
          providerAttachmentId: video.providerAttachmentId,
        })
        await options.publisher.publish(scope, {
          id: session.plannedMemoryId,
          childId: session.childId,
          kind: 'video',
          body: session.body,
          occurredAt: session.occurredAt,
          mediaIds: [],
          externalAttachment: 'max-video',
        }, async (tx, memoryId) => {
          await tx.maxVideoReference.upsert({
            where: { memoryId_familyId: { memoryId, familyId: scope.familyId } },
            create: {
              id: randomUUID(), outboundSourceId: outbound.id, memoryId, familyId: scope.familyId,
              attachmentPosition: 0, providerAttachmentId: video.providerAttachmentId,
              width: video.width, height: video.height,
              durationMs: video.inboundDurationSeconds === null ? null : Math.max(1, Math.round(video.inboundDurationSeconds * 1_000)),
            },
            update: { outboundSourceId: outbound.id, providerAttachmentId: video.providerAttachmentId,
              width: video.width, height: video.height,
              durationMs: video.inboundDurationSeconds === null ? null : Math.max(1, Math.round(video.inboundDurationSeconds * 1_000)) },
          })
        })
        const finalized = await options.repository.update(session, { state: 'finalized', lastErrorCode: null })
        return finalizedResult(scope, finalized, options.memoryReader)
      } catch (error) {
        if (error instanceof MaxDirectUploadFailure) {
          if (error.kind === 'retryable') await options.repository.update(session, { state: 'uploaded', lastErrorCode: error.code ?? 'retryable' })
          throw error
        }
        if (isAttachmentNotReady(error)) {
          await options.repository.update(session, { state: 'uploaded', lastErrorCode: 'attachment_not_ready' })
          return { state: 'processing', sessionId: session.id, retryable: true, code: 'attachment_not_ready' }
        }
        await options.repository.update(session, { state: 'uploaded', lastErrorCode: 'provider_unavailable' })
        throw new MaxDirectUploadFailure('retryable', 'Публикация видео временно недоступна', 'provider_unavailable')
      }
    },
  }
}

async function finalizedResult(scope: FamilyScope, session: MaxVideoUploadSession, reader?: MemoryReader): Promise<DirectVideoUploadFinalizeResult> {
  const memory = reader ? await reader.get(scope, session.plannedMemoryId) : undefined
  return { state: 'finalized', sessionId: session.id, memoryId: session.plannedMemoryId, ...(memory ? { memory } : {}) }
}

async function resolveMessage(api: MaxApiPort, messageId: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < attachmentReadyAttempts; attempt += 1) {
    try {
      return await api.getMessage(messageId)
    } catch (error) {
      lastError = error
      if (!isAttachmentNotReady(error) || attempt === attachmentReadyAttempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}

async function recipientId(repository: MaxDirectUploadRepository, scope: FamilyScope) {
  const resolved = await repository.findRecipientId?.(scope.familyId, scope.principal.userId)
  if (resolved && /^[1-9][0-9]*$/.test(resolved)) return resolved
  if (/^[1-9][0-9]*$/.test(scope.principal.userId)) return scope.principal.userId
  throw new MaxDirectUploadFailure('forbidden', 'MAX identity is unavailable')
}

async function assertChild(repository: MaxDirectUploadRepository, scope: FamilyScope, childId: string) {
  if (repository.assertChild) {
    const valid = await repository.assertChild(scope.familyId, childId)
    if (!valid) throw new MaxDirectUploadFailure('not_found', 'Профиль ребёнка не найден')
  }
}

function validateReservation(input: DirectVideoUploadReserveInput, current: Date) {
  const extension = input.fileName.toLowerCase().split('.').pop()
  const accepted = new Map([
    ['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['mkv', 'video/x-matroska'], ['webm', 'video/webm'],
  ])
  if (!extension || accepted.get(extension) !== input.mimeType || !Number.isSafeInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > maxFileBytes) {
    throw new MaxDirectUploadFailure('invalid_input', 'Поддерживаются видео MP4, MOV, MKV и WebM размером до 250 МБ')
  }
  if (!input.body.trim() || [...input.body].length > 8_000 || !input.idempotencyKey || input.idempotencyKey.length > 128) {
    throw new MaxDirectUploadFailure('invalid_input', 'Некорректные данные видео')
  }
  if (/[\\/\u0000-\u001f]/.test(input.fileName)) {
    throw new MaxDirectUploadFailure('invalid_input', 'Некорректное имя файла')
  }
  const occurredAt = new Date(input.occurredAt)
  if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > current.getTime() + 5 * 60 * 1_000) {
    throw new MaxDirectUploadFailure('invalid_input', 'Некорректная дата воспоминания')
  }
}

function fingerprint(input: DirectVideoUploadReserveInput) {
  return createHash('sha256').update(JSON.stringify({
    childId: input.childId, body: input.body.trim(), occurredAt: input.occurredAt,
    fileName: input.fileName, fileSize: input.fileSize, mimeType: input.mimeType,
  })).digest('hex')
}

function isAttachmentNotReady(error: unknown) {
  return typeof error === 'object' && error !== null &&
    ((error as { code?: unknown }).code === 'attachment.not.ready' || (error as { code?: unknown }).code === 'attachment_not_ready')
}

async function sendVideoMessageWithRetry(api: MaxApiPort, input: Parameters<MaxApiPort['sendVideoMessage']>[0]) {
  let lastError: unknown
  for (let attempt = 0; attempt < attachmentReadyAttempts; attempt += 1) {
    try {
      return await api.sendVideoMessage(input)
    } catch (error) {
      lastError = error
      if (!isAttachmentNotReady(error) || attempt === attachmentReadyAttempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}
