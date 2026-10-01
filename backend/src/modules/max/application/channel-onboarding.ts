import type { DbClient } from '../../../db'
import { insertTask } from '../../../outbox/store'
import { MaxChannelProviderError, readMaxInt64AtPath, readMaxRootInt64 } from './channel-protocol'

const lockKey = 7_341_288_911
const expiresInMs = 15 * 60_000
type Lifecycle = { kind: 'bot_added' | 'bot_removed' | 'bot_admin_permissions_changed'; rawPayload: string }
type Callback = { payload: string; userId: string; callbackId: string }

export function createMaxChannelOnboarding(options: {
  prisma: DbClient
  verifyChannel: (chatId: bigint) => Promise<{ title: string | null }>
  now?: () => Date
}) {
  const now = options.now ?? (() => new Date())

  async function processLifecycle(inboxId: string, event: Lifecycle) {
    const details = readLifecycle(event)
    // Provider I/O happens before the serialized transaction. No DB lock is held across network calls.
    let verified: { title: string | null } | null = null
    let accessLost = false
    if (event.kind !== 'bot_removed') {
      try { verified = await options.verifyChannel(details.chatId) }
      catch (error) { accessLost = error instanceof MaxChannelProviderError && error.permanentAccessLoss }
      if (!verified && !accessLost) throw new Error('MAX channel provider could not be verified; lifecycle event will retry')
    }
    let oneFamilyReplacement: { familyId: string; familyName: string; oldChatId: bigint; oldVersion: number; oldTitle: string | null } | null = null
    let oneFamilyOldUnavailable: { familyId: string; oldChatId: bigint; oldVersion: number } | null = null
    if (event.kind === 'bot_added' && verified) {
      const identity = await options.prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: details.actorSubject } }, select: { userId: true } })
      if (identity) {
        const memberships = await options.prisma.familyMember.findMany({
          where: { userId: identity.userId, role: 'full', revokedAt: null, family: { status: 'active' } },
          select: { familyId: true, family: { select: { name: true, maxBackupChatId: true } } },
        })
        const only = memberships.length === 1 ? memberships[0] : undefined
        const targetHistory = await options.prisma.maxChannelBinding.findUnique({ where: { chatId: details.chatId }, select: { familyId: true } })
        const historicalFamily = targetHistory?.familyId ? memberships.find((item) => item.familyId === targetHistory.familyId) : undefined
        const replacementFamily = historicalFamily ?? only
        if (replacementFamily?.family.maxBackupChatId && replacementFamily.family.maxBackupChatId !== details.chatId) {
          const old = await options.prisma.maxChannelBinding.findUnique({ where: { chatId: replacementFamily.family.maxBackupChatId } })
          if (old?.state === 'connected') {
            try {
              await options.verifyChannel(old.chatId)
              oneFamilyReplacement = { familyId: replacementFamily.familyId, familyName: replacementFamily.family.name, oldChatId: old.chatId, oldVersion: old.version, oldTitle: old.title }
            } catch (error) {
              if (!(error instanceof MaxChannelProviderError) || !error.permanentAccessLoss) throw error
              oneFamilyOldUnavailable = { familyId: replacementFamily.familyId, oldChatId: old.chatId, oldVersion: old.version }
            }
          } else oneFamilyOldUnavailable = { familyId: replacementFamily.familyId, oldChatId: replacementFamily.family.maxBackupChatId, oldVersion: old?.version ?? 0 }
        }
      }
    }
    await options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const current = await tx.maxChannelBinding.findUnique({ where: { chatId: details.chatId } })
      if (current?.lastLifecycleAt && current.lastLifecycleAt.getTime() >= details.occurredAt.getTime()) {
        await finishInbox(tx, inboxId)
        return
      }
      if (event.kind === 'bot_removed') {
        if (current?.familyId) await lockFamilyRows(tx, [current.familyId])
        await tx.maxChannelBinding.upsert({
          where: { chatId: details.chatId },
          create: { chatId: details.chatId, familyId: current?.familyId ?? null, title: current?.title ?? null,
            state: 'disconnected', version: (current?.version ?? 0) + 1, lastLifecycleAt: details.occurredAt },
          update: { state: 'disconnected', version: { increment: 1 }, lastLifecycleAt: details.occurredAt },
        })
        if (current?.familyId) {
          await tx.family.updateMany({ where: { id: current.familyId, maxBackupChatId: details.chatId }, data: { maxBackupChatId: null } })
          await detachUnsentBackups(tx, current.familyId, details.chatId)
        }
      } else if (!verified && accessLost) {
        if (current?.familyId) await lockFamilyRows(tx, [current.familyId])
        await tx.maxChannelBinding.upsert({
          where: { chatId: details.chatId },
          create: { chatId: details.chatId, title: current?.title ?? null, familyId: current?.familyId ?? null,
            state: 'permission_problem', version: (current?.version ?? 0) + 1, lastLifecycleAt: details.occurredAt },
          update: { state: 'permission_problem', version: { increment: 1 }, lastLifecycleAt: details.occurredAt },
        })
        if (current?.familyId) {
          await tx.family.updateMany({ where: { id: current.familyId, maxBackupChatId: details.chatId }, data: { maxBackupChatId: null } })
          await detachUnsentBackups(tx, current.familyId, details.chatId)
        }
      } else if (verified) {
        const identity = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: details.actorSubject } }, select: { userId: true } })
        const eligible = identity ? await tx.familyMember.findMany({
          where: { userId: identity.userId, role: 'full', revokedAt: null, family: { status: 'active' } },
          select: { familyId: true, family: { select: { name: true, maxBackupChatId: true } } },
        }) : []
        const candidates = current?.familyId ? eligible.filter((item) => item.familyId === current.familyId) : eligible
        const historiedFamily = current?.familyId ? eligible.find((item) => item.familyId === current.familyId) : undefined
        const uniquelyResolvedFamily = candidates.length === 1 ? candidates[0] : historiedFamily
        const activeChatId = uniquelyResolvedFamily?.family.maxBackupChatId
        const activeWasPreverified = Boolean(uniquelyResolvedFamily && activeChatId && activeChatId !== details.chatId && (
          (oneFamilyReplacement?.familyId === uniquelyResolvedFamily.familyId && oneFamilyReplacement.oldChatId === activeChatId) ||
          (oneFamilyOldUnavailable?.familyId === uniquelyResolvedFamily.familyId && oneFamilyOldUnavailable.oldChatId === activeChatId)
        ))
        if (activeChatId && activeChatId !== details.chatId && uniquelyResolvedFamily && !activeWasPreverified) {
          // A concurrent lifecycle transaction bound a channel after the outside-lock
          // reads. Roll back so this inbox retries after verifying the current channel.
          throw new Error('MAX active channel changed during lifecycle preflight; retry with current channel health')
        }
        const staleOld = oneFamilyOldUnavailable && candidates.length === 1 && candidates[0]!.familyId === oneFamilyOldUnavailable.familyId &&
          candidates[0]!.family.maxBackupChatId === oneFamilyOldUnavailable.oldChatId
        const candidate = historiedFamily ?? (candidates.length === 1 &&
          (candidates[0]!.family.maxBackupChatId === null || candidates[0]!.family.maxBackupChatId === details.chatId || staleOld)
          ? candidates[0] : undefined)
        const currentActor = candidate ? await lockCurrentFullActorFamily(tx, details.actorSubject, candidate.familyId) : null
        if (!candidate && current?.familyId) await lockFamilyRows(tx, [current.familyId])
        const saved = await tx.maxChannelBinding.upsert({
          where: { chatId: details.chatId },
          create: { chatId: details.chatId, title: verified.title, state: 'connected', version: 1, lastLifecycleAt: details.occurredAt },
          update: { title: verified.title, state: 'connected', version: { increment: 1 }, lastLifecycleAt: details.occurredAt },
        })
        if (candidate && currentActor?.userId === identity?.userId &&
            (!candidate.family.maxBackupChatId || candidate.family.maxBackupChatId === details.chatId || staleOld)) {
          if (staleOld && oneFamilyOldUnavailable) {
            const old = await tx.maxChannelBinding.findUnique({ where: { chatId: oneFamilyOldUnavailable.oldChatId } })
            if ((old?.version ?? 0) !== oneFamilyOldUnavailable.oldVersion) throw new Error('MAX channel binding changed concurrently')
            if (old) await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'permission_problem', version: { increment: 1 }, lastProviderCheckAt: now() } })
            await tx.family.updateMany({ where: { id: candidate.familyId, maxBackupChatId: oneFamilyOldUnavailable.oldChatId }, data: { maxBackupChatId: null } })
            await detachUnsentBackups(tx, candidate.familyId, oneFamilyOldUnavailable.oldChatId)
          }
          await bindMaxChannelAndQueue(tx, candidate.familyId, details.chatId, saved.version)
          await tx.maxChannelBinding.update({ where: { chatId: details.chatId }, data: { familyId: candidate.familyId } })
          await createSimpleResponse(tx, inboxId, details.actorSubject, `Канал ${verified.title ? `“${verified.title}”` : ''} подключён к семье “${candidate.family.name}”.`)
        } else if (identity && candidates.length > 0) {
          const replaceTarget = oneFamilyReplacement && candidates.length === 1 &&
            oneFamilyReplacement.familyId === candidates[0]!.familyId &&
            candidates[0]!.family.maxBackupChatId === oneFamilyReplacement.oldChatId ? oneFamilyReplacement : null
          const decision = await tx.maxChannelDecision.create({ data: {
            originInboxId: inboxId, actorSubject: details.actorSubject, actorUserId: identity.userId,
            chatId: details.chatId, candidateFamilyIds: candidates.map((item) => item.familyId),
            expectedActiveChatId: replaceTarget?.oldChatId ?? null,
            expectedActiveVersion: replaceTarget?.oldVersion ?? 0,
            expectedChannelVersion: saved.version,
            phase: replaceTarget ? 'confirm_replacement' : 'select_family',
            ...(replaceTarget ? { selectedFamilyId: replaceTarget.familyId } : {}),
            status: 'pending', expiresAt: new Date(now().getTime() + expiresInMs),
          } })
          if (replaceTarget) {
            await createDecisionResponse(tx, inboxId, details.actorSubject, decision.id,
              `Заменить ${replaceTarget.oldTitle ? `“${replaceTarget.oldTitle}”` : 'текущий канал'} на ${verified.title ? `“${verified.title}”` : 'новый канал'}?`, [], now(), [
                { text: 'Заменить', payload: `max_channel:${decision.id}:replace:0` },
                { text: 'Отмена', payload: `max_channel:${decision.id}:cancel:0` },
              ])
          } else {
            await createDecisionResponse(tx, inboxId, details.actorSubject, decision.id,
              'К какой семье относится этот канал?', candidates.map((item) => ({ id: item.familyId, name: item.family.name })), now())
          }
        }
      }
      await finishInbox(tx, inboxId)
    })
  }

  async function processCallback(inboxId: string, event: Callback) {
    const match = /^max_channel:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(select|replace|cancel):([0-9]{1,15})$/i.exec(event.payload)
    if (!match) return false
    const decisionId = match[1]!
    const action = match[2]!
    const index = Number(match[3])
    if (!Number.isSafeInteger(index)) {
      await options.prisma.$transaction((tx) => finishInbox(tx, inboxId))
      return true
    }
    const decision = await options.prisma.maxChannelDecision.findUnique({ where: { id: decisionId } })
    if (!decision || decision.actorSubject !== event.userId || decision.status !== 'pending' || decision.expiresAt <= now()) {
      await options.prisma.$transaction((tx) => finishInbox(tx, inboxId))
      return true
    }
    const candidateIds = Array.isArray(decision.candidateFamilyIds) ? decision.candidateFamilyIds.filter((id): id is string => typeof id === 'string') : []
    let verify: { title: string | null } | null = null
    let checkedOld: { chatId: bigint; version: number | null; state: string | null; available: boolean } | null = null
    if (action !== 'cancel') {
      try { verify = await options.verifyChannel(decision.chatId) }
      catch (error) {
        if (!(error instanceof MaxChannelProviderError) || !error.permanentAccessLoss) throw error
        await options.prisma.$transaction((tx) => finishInbox(tx, inboxId)); return true
      }
      if (action === 'select' && decision.phase === 'select_family') {
        const familyId = candidateIds[index]
        const family = familyId ? await options.prisma.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } }) : null
        const oldChatId = family?.maxBackupChatId && family.maxBackupChatId !== decision.chatId ? family.maxBackupChatId : null
        if (oldChatId) {
          const oldBinding = await options.prisma.maxChannelBinding.findUnique({ where: { chatId: oldChatId } })
          if (oldBinding?.state === 'connected') {
            try {
              await options.verifyChannel(oldChatId)
              checkedOld = { chatId: oldChatId, version: oldBinding.version, state: oldBinding.state, available: true }
            }
            catch (error) {
              if (!(error instanceof MaxChannelProviderError) || !error.permanentAccessLoss) throw error
              checkedOld = { chatId: oldChatId, version: oldBinding.version, state: oldBinding.state, available: false }
            }
          } else checkedOld = { chatId: oldChatId, version: oldBinding?.version ?? null, state: oldBinding?.state ?? null, available: false }
        }
      }
    }
    await options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const locked = await tx.maxChannelDecision.findUnique({ where: { id: decisionId } })
      if (!locked || locked.status !== 'pending' || locked.actorSubject !== event.userId || locked.expiresAt <= now()) return
      const binding = await tx.maxChannelBinding.findUnique({ where: { chatId: locked.chatId } })
      if (!binding || binding.version !== locked.expectedChannelVersion) return
      if (action === 'cancel') {
        await tx.maxChannelDecision.updateMany({ where: { id: decisionId, status: 'pending' }, data: { status: 'cancelled' } })
        await finishInbox(tx, inboxId)
        return
      }
      if (action === 'select' && locked.phase === 'select_family') {
        const familyId = candidateIds[index]
        if (!familyId || (await lockCurrentFullActorFamily(tx, locked.actorSubject, familyId))?.userId !== locked.actorUserId) return
        const family = await tx.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } })
        if (!family) return
        if (family.maxBackupChatId !== null && family.maxBackupChatId !== locked.chatId) {
          if (!checkedOld || checkedOld.chatId !== family.maxBackupChatId) return
          const old = await tx.maxChannelBinding.findUnique({ where: { chatId: family.maxBackupChatId } })
          if (old?.state === 'connected' && checkedOld.available && checkedOld.version === old.version && checkedOld.state === old.state) {
            await tx.maxChannelDecision.update({ where: { id: decisionId }, data: {
              phase: 'confirm_replacement', selectedFamilyId: familyId,
              expectedActiveChatId: old.chatId, expectedActiveVersion: old.version,
            } })
            const oldTitle = old.title ? `“${old.title}”` : 'текущий канал'
            const newTitle = binding.title ? `“${binding.title}”` : 'новый канал'
            await createDecisionResponse(tx, inboxId, event.userId, decisionId,
              `Заменить ${oldTitle} на ${newTitle}?`, [], now(), [
                { text: 'Заменить', payload: `max_channel:${decisionId}:replace:0` },
                { text: 'Отмена', payload: `max_channel:${decisionId}:cancel:0` },
              ])
            await finishInbox(tx, inboxId)
            return
          }
          // Clear an old pointer only when the row still matches the state/version
          // whose permanent loss (or already-disconnected state) was observed before
          // acquiring Family locks. A concurrent healthy replacement stays untouched.
          if ((old?.version ?? null) !== checkedOld.version || (old?.state ?? null) !== checkedOld.state || checkedOld.available) return
          if (old?.state === 'connected') {
            await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'permission_problem', version: { increment: 1 }, lastProviderCheckAt: now() } })
            await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: old.chatId }, data: { maxBackupChatId: null } })
            await detachUnsentBackups(tx, familyId, old.chatId)
          }
          await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: family.maxBackupChatId }, data: { maxBackupChatId: null } })
          await detachUnsentBackups(tx, familyId, family.maxBackupChatId)
        }
        await bindMaxChannelAndQueue(tx, familyId, locked.chatId, binding.version)
        await tx.maxChannelBinding.update({ where: { chatId: locked.chatId }, data: { familyId, state: 'connected' } })
        await tx.maxChannelDecision.update({ where: { id: decisionId }, data: { status: 'completed' } })
        await createSimpleResponse(tx, inboxId, event.userId, 'Канал подключён к семье.')
      } else if (action === 'replace' && locked.phase === 'confirm_replacement' && verify && locked.selectedFamilyId) {
        const familyId = locked.selectedFamilyId
        if ((await lockCurrentFullActorFamily(tx, locked.actorSubject, familyId))?.userId !== locked.actorUserId) return
        const family = await tx.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } })
        if (!family || family.maxBackupChatId !== locked.expectedActiveChatId) return
        const old = locked.expectedActiveChatId ? await tx.maxChannelBinding.findUnique({ where: { chatId: locked.expectedActiveChatId } }) : null
        if (!old || old.version !== locked.expectedActiveVersion || !['connected', 'permission_problem', 'disconnected'].includes(old.state)) return
        await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'replaced', version: { increment: 1 } } })
        await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: old.chatId }, data: { maxBackupChatId: null } })
        await detachUnsentBackups(tx, familyId, old.chatId)
        await bindMaxChannelAndQueue(tx, familyId, locked.chatId, binding.version)
        await tx.maxChannelBinding.update({ where: { chatId: locked.chatId }, data: { familyId, state: 'connected', title: verify.title } })
        await tx.maxChannelDecision.update({ where: { id: decisionId }, data: { status: 'completed' } })
        await createSimpleResponse(tx, inboxId, event.userId, 'Канал успешно заменён.')
      }
      await finishInbox(tx, inboxId)
    })
    await options.prisma.$transaction((tx) => finishInbox(tx, inboxId))
    return true
  }

  async function status(familyId: string, userId: string) {
    const membership = await options.prisma.familyMember.findFirst({
      where: { familyId, userId, revokedAt: null, family: { status: 'active' } },
      select: { role: true, family: { select: { maxBackupChatId: true } } },
    })
    if (!membership) throw new Error('family_not_found')
    const chatId = membership.family.maxBackupChatId
    let binding = chatId === null
      ? await options.prisma.maxChannelBinding.findFirst({ where: { familyId, state: { in: ['disconnected', 'permission_problem', 'replaced'] } }, orderBy: { updatedAt: 'desc' } })
      : await options.prisma.maxChannelBinding.findUnique({ where: { chatId } })
    if (chatId !== null && binding?.state === 'connected') {
      try {
        const current = await options.verifyChannel(chatId)
        await options.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
          await lockFamilyRows(tx, [familyId])
          const currentFamily = await tx.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } })
          if (currentFamily?.maxBackupChatId !== chatId) return
          await tx.maxChannelBinding.updateMany({
            where: { chatId, version: binding!.version, state: 'connected' },
            data: { title: current.title, lastProviderCheckAt: now() },
          })
        })
      } catch (error) {
        if (error instanceof MaxChannelProviderError && error.permanentAccessLoss) {
          await options.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
            const latest = await tx.maxChannelBinding.findUnique({ where: { chatId } })
            if (!latest || latest.version !== binding!.version || latest.state !== 'connected') return
            await lockFamilyRows(tx, [familyId])
            await tx.maxChannelBinding.update({ where: { chatId }, data: { state: 'permission_problem', version: { increment: 1 }, lastProviderCheckAt: now() } })
            await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: chatId }, data: { maxBackupChatId: null } })
            await detachUnsentBackups(tx, familyId, chatId)
          })
          binding = await options.prisma.maxChannelBinding.findUnique({ where: { chatId } })
        }
      }
    }
    const currentMembership = await options.prisma.familyMember.findFirst({
      where: { familyId, userId, revokedAt: null, family: { status: 'active' } },
      select: { role: true, family: { select: { maxBackupChatId: true } } },
    })
    if (!currentMembership) throw new Error('family_not_found')
    const currentChatId = currentMembership.family.maxBackupChatId
    binding = currentChatId === null
      ? await options.prisma.maxChannelBinding.findFirst({ where: { familyId, state: { in: ['disconnected', 'permission_problem', 'replaced'] } }, orderBy: { updatedAt: 'desc' } })
      : await options.prisma.maxChannelBinding.findUnique({ where: { chatId: currentChatId } })
    return { state: binding?.state === 'permission_problem' ? 'permission_problem' as const : currentChatId === null && !binding ? 'unconfigured' as const :
      currentChatId === null || binding?.state === 'disconnected' || binding?.state === 'replaced' ? 'disconnected' as const : 'connected' as const,
    title: binding?.title ?? null, canManage: currentMembership.role === 'full' }
  }

  return { processLifecycle, processCallback, status }
}

export async function bindMaxChannelAndQueue(tx: any, familyId: string, chatId: bigint, channelVersion: number) {
  const occupied = await tx.family.findFirst({ where: { maxBackupChatId: chatId, id: { not: familyId } }, select: { id: true } })
  if (occupied) throw new Error('MAX channel is already bound to another family')
  const result = await tx.family.updateMany({ where: { id: familyId, OR: [{ maxBackupChatId: null }, { maxBackupChatId: chatId }] }, data: { maxBackupChatId: chatId } })
  if (result.count !== 1) throw new Error('Family MAX channel binding changed')
  const backups = await tx.maxMemoryBackup.updateManyAndReturn({
    where: { familyId, state: { in: ['needs_configuration', 'pending', 'uploading'] }, sendIntentAt: null, providerMessageId: null },
    data: { channelChatId: chatId, state: 'pending', lastErrorCode: null }, select: { memoryId: true },
  })
  for (const backup of backups) await insertTask(tx, {
    type: 'max:backup-media', dedupeKey: `max-backup-media:${backup.memoryId}:channel:${chatId}:${channelVersion}`,
    payload: { memoryId: backup.memoryId },
  })
  return backups.length
}

async function detachUnsentBackups(tx: any, familyId: string, chatId: bigint) {
  await tx.maxMemoryBackup.updateMany({
    where: { familyId, channelChatId: chatId, state: { in: ['needs_configuration', 'pending', 'uploading'] }, sendIntentAt: null, providerMessageId: null },
    data: { channelChatId: null, state: 'needs_configuration', lastErrorCode: 'backup_channel_not_configured' },
  })
}

async function lockCurrentFullActorFamily(tx: any, subject: string, familyId: string) {
  const identity = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id FROM external_identities WHERE provider = 'max' AND subject = ${subject} FOR UPDATE
  `
  const userId = identity[0]?.user_id
  if (!userId) return null
  await lockFamilyRows(tx, [familyId])
  const family = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM families WHERE id = ${familyId}::uuid`
  if (!family.length) return null
  const membership = await tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT fm.user_id FROM family_members fm JOIN families f ON f.id = fm.family_id
    WHERE fm.family_id = ${familyId}::uuid AND fm.user_id = ${userId}::uuid AND fm.role = 'full'
      AND fm.revoked_at IS NULL AND f.status = 'active' FOR UPDATE OF fm
  `
  return membership.length ? { userId } : null
}

async function lockFamilyRows(tx: any, familyIds: string[]) {
  for (const familyId of [...new Set(familyIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM families WHERE id = ${familyId}::uuid FOR UPDATE`
  }
}

async function finishInbox(tx: any, inboxId: string) {
  await tx.maxInbox.updateMany({ where: { id: inboxId, status: 'accepted' }, data: {
    status: 'processed', processedAt: new Date(), encryptedPayload: Buffer.alloc(0), encryptionIv: Buffer.alloc(0), encryptionAuthTag: Buffer.alloc(0),
  } })
}

async function createDecisionResponse(tx: any, inboxId: string, actorSubject: string, decisionId: string, text: string,
  candidates: Array<{ id: string; name: string }>, scheduledFor: Date, buttons?: Array<{ text: string; payload: string }>) {
  const selectionButtons = candidates.map((item, index) => ({ text: item.name.slice(0, 64), payload: `max_channel:${decisionId}:select:${index}` }))
  const response = await tx.maxOutgoingResponse.create({ data: {
    inboxId, channelDecisionId: decisionId, destinationUserId: BigInt(actorSubject), kind: 'family_choice',
    text,
    buttons: buttons ?? selectionButtons,
  }, select: { id: true } })
  await insertTask(tx, { type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor })
}

async function createSimpleResponse(tx: any, inboxId: string, actorSubject: string, text: string) {
  const response = await tx.maxOutgoingResponse.create({ data: {
    inboxId, destinationUserId: BigInt(actorSubject), kind: 'welcome', text,
  }, select: { id: true } })
  await insertTask(tx, { type: 'max:deliver-response', dedupeKey: `max-response:${response.id}`, payload: { responseId: response.id }, scheduledFor: new Date() })
}

function readLifecycle(event: Lifecycle) {
  const raw = event.rawPayload
  const parsed = JSON.parse(raw) as Record<string, any>
  const chatId = readMaxRootInt64(raw, 'chat_id')
  const occurredAt = new Date(parsed.timestamp)
  const actorId = readMaxInt64AtPath(raw, ['user', 'user_id'])
  if (chatId === null || chatId === 0n || !Number.isSafeInteger(parsed.timestamp) || (event.kind === 'bot_added' && actorId === null)) throw new Error('Invalid MAX lifecycle event')
  return { chatId, occurredAt, actorSubject: actorId === null ? '' : actorId.toString() }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
