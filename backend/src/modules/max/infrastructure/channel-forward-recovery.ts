import { createHash } from 'node:crypto'
import type { DbClient } from '../../../db'
import type { MaxApiPort, MaxInboundEvent } from '../application/ports'
import type { EncryptedMaxPayload } from './payload-crypto'
import { materializeMaxChannelForward } from './forward-import'

type Options = { db: DbClient; api: MaxApiPort; botId: string; now?: () => Date }
const recoveryKey = (sourceId: string, fingerprint: string) => `max-channel-forward-repair:v1:${sourceId}:${fingerprint}`

/** One explicit recent, empty, terminal source only. This is not channel-history import. */
export async function planMaxChannelForwardRecovery(options: Options, sourceId: string) {
  const { db } = options
  const source = await db.maxSource.findUnique({ where: { id: sourceId }, include: {
    inbox: true, attachments: { select: { id: true } }, videoReferences: { select: { id: true } },
  } })
  const now = (options.now ?? (() => new Date()))()
  if (!source || source.botId.toString() !== options.botId || source.status !== 'denied' || source.rejectionCode !== 'denied' ||
      source.senderSubject !== '0' || source.memoryId || source.userId || source.familyId || source.childId ||
      source.originalMessageId || source.originalChannelId || source.attachments.length || source.videoReferences.length ||
      source.inbox.status !== 'processed' || source.inbox.controlRedactedAt || source.inbox.encryptedPayload.length ||
      source.createdAt.getTime() < now.getTime() - 24 * 60 * 60 * 1_000 || source.createdAt > now ||
      await db.memory.findUnique({ where: { id: source.plannedMemoryId }, select: { id: true } })) {
    throw new Error('channel_forward_recovery_ineligible')
  }
  const binding = await db.maxChannelBinding.findUnique({ where: { chatId: source.recipientId } })
  const family = binding?.familyId ? await db.family.findFirst({ where: {
    id: binding.familyId, status: 'active', maxBackupChatId: source.recipientId, owner: { controlState: 'active' },
  }, select: { id: true, ownerUserId: true, children: { where: { deletedAt: null }, take: 1, select: { id: true } } } }) : null
  if (!family || binding?.state !== 'connected' || !family.children.length || !await db.familyMember.findFirst({ where: {
    familyId: family.id, userId: family.ownerUserId, role: 'full', revokedAt: null,
  }, select: { userId: true } })) throw new Error('channel_forward_recovery_binding_unavailable')
  const outer = await options.api.getMessage(source.messageId)
  if (!outer.forwardedFrom) throw new Error('channel_forward_recovery_not_forwarded')
  const event: Extract<MaxInboundEvent, { kind: 'message_created' }> = {
    kind: 'message_created', isChannel: true, senderId: source.senderSubject, recipientId: source.recipientId.toString(),
    messageId: source.messageId, occurredAt: source.createdAt.toISOString(), text: null, attachments: [],
    forwardedFrom: { messageId: outer.forwardedFrom.messageId },
  }
  const canonical = materializeMaxChannelForward(outer, event)
  if (!canonical.attachments.length && !canonical.text?.trim()) throw new Error('channel_forward_recovery_empty')
  const fingerprint = createHash('sha256').update(JSON.stringify({
    sourceId, sourceUpdatedAt: source.updatedAt.toISOString(), inboxId: source.inboxId,
    plannedMemoryId: source.plannedMemoryId, botId: options.botId, messageId: source.messageId,
    channelId: source.recipientId.toString(), originalId: outer.forwardedFrom.messageId,
    familyId: family.id, ownerUserId: family.ownerUserId, bindingVersion: binding.version,
    textHash: createHash('sha256').update(canonical.text ?? '').digest('hex'),
    attachments: canonical.attachments.map(({ kind, providerAttachmentId }) => ({ kind, providerAttachmentId })),
  })).digest('hex')
  return { sourceId, inboxId: source.inboxId, familyId: family.id, ownerUserId: family.ownerUserId,
    channelId: source.recipientId, bindingVersion: binding.version, sourceUpdatedAt: source.updatedAt,
    plannedMemoryId: source.plannedMemoryId, event, fingerprint }
}

export async function queueMaxChannelForwardRecovery(options: Options & { encrypt: (event: unknown) => EncryptedMaxPayload },
  sourceId: string, expectedFingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) throw new Error('channel_forward_recovery_fingerprint_required')
  const key = recoveryKey(sourceId, expectedFingerprint)
  if (await options.db.taskOutbox.findUnique({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: key } } })) {
    return { status: 'already_queued' as const }
  }
  const plan = await planMaxChannelForwardRecovery(options, sourceId)
  if (plan.fingerprint !== expectedFingerprint) throw new Error('channel_forward_recovery_plan_changed')
  const encrypted = options.encrypt(plan.event)
  return options.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM families WHERE id = ${plan.familyId}::uuid FOR UPDATE`
    if (await tx.taskOutbox.findUnique({ where: { type_dedupeKey: { type: 'max:process', dedupeKey: key } } })) {
      return { status: 'already_queued' as const }
    }
    const family = await tx.family.findFirst({ where: { id: plan.familyId, status: 'active',
      ownerUserId: plan.ownerUserId, owner: { controlState: 'active' }, maxBackupChatId: plan.channelId, children: { some: { deletedAt: null } },
      members: { some: { userId: plan.ownerUserId, role: 'full', revokedAt: null } },
    }, select: { id: true } })
    const binding = await tx.maxChannelBinding.findFirst({ where: { chatId: plan.channelId, familyId: plan.familyId,
      state: 'connected', version: plan.bindingVersion }, select: { chatId: true } })
    if (!family || !binding) throw new Error('channel_forward_recovery_binding_changed')
    const changed = await tx.maxSource.updateMany({ where: { id: sourceId, status: 'denied', rejectionCode: 'denied',
      updatedAt: plan.sourceUpdatedAt, botId: BigInt(options.botId), senderSubject: '0', recipientId: plan.channelId,
      userId: null, familyId: null, childId: null, memoryId: null, originalMessageId: null, originalChannelId: null,
      attachments: { none: {} }, videoReferences: { none: {} },
      inbox: { status: 'processed', controlRedactedAt: null },
    }, data: { status: 'accepted', rejectionCode: null } })
    if (changed.count !== 1) throw new Error('channel_forward_recovery_source_changed')
    if (await tx.memory.findUnique({ where: { id: plan.plannedMemoryId }, select: { id: true } })) {
      throw new Error('channel_forward_recovery_memory_exists')
    }
    const inbox = await tx.maxInbox.updateMany({ where: { id: plan.inboxId, status: 'processed', controlRedactedAt: null },
      data: { status: 'accepted', processedAt: null, encryptedPayload: Buffer.from(encrypted.ciphertext),
        encryptionIv: Buffer.from(encrypted.iv), encryptionAuthTag: Buffer.from(encrypted.authTag) } })
    if (inbox.count !== 1) throw new Error('channel_forward_recovery_inbox_changed')
    await tx.taskOutbox.create({ data: { type: 'max:process', dedupeKey: key, payload: { inboxId: plan.inboxId } } })
    return { status: 'queued' as const }
  })
}
