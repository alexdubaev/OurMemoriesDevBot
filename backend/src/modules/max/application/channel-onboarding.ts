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
  verifyActorAdmin?: (chatId: bigint, actorSubject: bigint) => Promise<boolean>
  now?: () => Date
}) {
  const now = options.now ?? (() => new Date())

  async function processLifecycle(inboxId: string, event: Lifecycle) {
    const details = readLifecycle(event)
    const pendingProvenance = event.kind === 'bot_admin_permissions_changed'
      ? await options.prisma.maxChannelDecision.findFirst({ where: { chatId: details.chatId, phase: 'await_permissions', status: 'pending', expiresAt: { gt: now() } }, orderBy: { createdAt: 'desc' } })
      : null
    // Provider I/O happens before the serialized transaction. No DB lock is held across network calls.
    let verified: { title: string | null } | null = null
    let accessLost = false
    if (event.kind !== 'bot_removed') {
      try { verified = await options.verifyChannel(details.chatId) }
      catch (error) { accessLost = error instanceof MaxChannelProviderError && error.permanentAccessLoss }
      if (!verified && !accessLost) throw new Error('MAX channel provider could not be verified; lifecycle event will retry')
    }
    let oneFamilyReplacement: { familyId: string; familyName: string; oldChatId: bigint; oldVersion: number; oldTitle: string | null } | null = null
    let oneFamilyOldUnavailable: { familyId: string; oldChatId: bigint; oldVersion: number; oldState: string | null } | null = null
    let lifecycleResult: { state: string; familyAssociated: boolean; decisionCategory: string } | undefined
    if ((event.kind === 'bot_added' && verified) || (pendingProvenance && verified)) {
      const actorSubject = pendingProvenance?.actorSubject ?? details.actorSubject
      const identity = await options.prisma.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: actorSubject } }, select: { userId: true } })
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
              oneFamilyOldUnavailable = { familyId: replacementFamily.familyId, oldChatId: old.chatId, oldVersion: old.version, oldState: old.state }
            }
          } else oneFamilyOldUnavailable = { familyId: replacementFamily.familyId, oldChatId: replacementFamily.family.maxBackupChatId, oldVersion: old?.version ?? 0, oldState: old?.state ?? null }
        }
      }
    }
    await options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const current = await tx.maxChannelBinding.findUnique({ where: { chatId: details.chatId } })
      const trustedProvenance = event.kind === 'bot_admin_permissions_changed'
        ? await tx.maxChannelDecision.findFirst({ where: { chatId: details.chatId, phase: 'await_permissions', status: 'pending', expiresAt: { gt: now() } }, orderBy: { createdAt: 'desc' } })
        : null
      if (event.kind === 'bot_admin_permissions_changed' && trustedProvenance && pendingProvenance?.id !== trustedProvenance.id) {
        throw new Error('MAX pending lifecycle provenance changed during provider verification; retry with current provenance')
      }
      if (current?.lastLifecycleAt && (current.lastLifecycleAt.getTime() > details.occurredAt.getTime() ||
          current.lastLifecycleAt.getTime() === details.occurredAt.getTime() &&
          (event.kind !== 'bot_removed' || current.state === 'disconnected'))) {
        lifecycleResult = await readLifecycleResult(tx, details.chatId, 'stale')
        await finishInbox(tx, inboxId)
        return
      }
      if (event.kind === 'bot_removed') {
        await tx.maxChannelDecision.updateMany({ where: { chatId: details.chatId, status: 'pending' }, data: { status: 'cancelled' } })
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
      } else if (event.kind === 'bot_admin_permissions_changed' && !trustedProvenance && current?.state === 'disconnected') {
        await tx.maxChannelBinding.update({ where: { chatId: details.chatId }, data: { lastLifecycleAt: details.occurredAt } })
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
        if (event.kind === 'bot_added') {
          await tx.maxChannelDecision.updateMany({ where: { chatId: details.chatId, status: 'pending' }, data: { status: 'cancelled' } })
          const identity = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: details.actorSubject } }, select: { userId: true } })
          const eligible = identity ? await tx.familyMember.findMany({ where: { userId: identity.userId, role: 'full', revokedAt: null, family: { status: 'active' } },
            select: { familyId: true } }) : []
          const candidates = current?.familyId ? eligible.filter((item) => item.familyId === current.familyId) : eligible
          if (identity && candidates.length) {
            const valid: string[] = []
            for (const item of candidates) if ((await lockCurrentFullActorFamily(tx, details.actorSubject, item.familyId))?.userId === identity.userId) valid.push(item.familyId)
            if (valid.length) await tx.maxChannelDecision.create({ data: {
              originInboxId: inboxId, actorSubject: details.actorSubject, actorUserId: identity.userId, chatId: details.chatId,
              candidateFamilyIds: valid, expectedActiveChatId: null, expectedActiveVersion: 0,
              expectedChannelVersion: (current?.version ?? 0) + 1, phase: 'await_permissions', status: 'pending',
              expiresAt: new Date(now().getTime() + expiresInMs),
            } })
          }
        } else if (trustedProvenance) {
          const stillMapped = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: trustedProvenance.actorSubject } }, select: { userId: true } })
          const candidateIds = Array.isArray(trustedProvenance.candidateFamilyIds) ? trustedProvenance.candidateFamilyIds.filter((id): id is string => typeof id === 'string') : []
          const stillEligible: string[] = []
          if (stillMapped?.userId === trustedProvenance.actorUserId) {
            for (const familyId of candidateIds) if ((await lockCurrentFullActorFamily(tx, trustedProvenance.actorSubject, familyId))?.userId === trustedProvenance.actorUserId) stillEligible.push(familyId)
          }
          if (!stillEligible.length) await tx.maxChannelDecision.update({ where: { id: trustedProvenance.id }, data: { status: 'cancelled' } })
          else await tx.maxChannelDecision.update({ where: { id: trustedProvenance.id }, data: { candidateFamilyIds: stillEligible, expectedChannelVersion: (current?.version ?? 0) + 1 } })
        }
      } else if (verified && event.kind === 'bot_admin_permissions_changed' && !trustedProvenance && current?.state === 'disconnected') {
        await tx.maxChannelBinding.update({ where: { chatId: details.chatId }, data: { title: verified.title, lastLifecycleAt: details.occurredAt } })
      } else if (verified) {
        if (trustedProvenance) {
          const decision = await tx.maxChannelDecision.findUnique({ where: { id: trustedProvenance.id } })
          const actorIdentity = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: trustedProvenance.actorSubject } }, select: { userId: true } })
          const candidateIds = Array.isArray(decision?.candidateFamilyIds) ? decision.candidateFamilyIds.filter((id): id is string => typeof id === 'string') : []
          const eligible = actorIdentity?.userId === trustedProvenance.actorUserId
            ? await tx.familyMember.findMany({ where: { userId: trustedProvenance.actorUserId!, role: 'full', revokedAt: null, familyId: { in: candidateIds }, family: { status: 'active' } },
              select: { familyId: true, family: { select: { name: true, maxBackupChatId: true } } } }) : []
          const candidates = eligible.filter((item) => candidateIds.includes(item.familyId))
          const validCandidates = []
          for (const item of candidates) if ((await lockCurrentFullActorFamily(tx, trustedProvenance.actorSubject, item.familyId))?.userId === trustedProvenance.actorUserId) validCandidates.push(item)
          const saved = await tx.maxChannelBinding.upsert({ where: { chatId: details.chatId },
            create: { chatId: details.chatId, title: verified.title, familyId: null, state: 'connected', version: 1, lastLifecycleAt: details.occurredAt },
            update: { title: verified.title, state: 'connected', version: { increment: 1 }, lastLifecycleAt: details.occurredAt } })
          if (!decision || decision.status !== 'pending' || decision.phase !== 'await_permissions' || decision.expectedChannelVersion !== current?.version || !validCandidates.length) {
            if (decision?.status === 'pending') await tx.maxChannelDecision.update({ where: { id: decision.id }, data: { status: 'cancelled' } })
          } else if (validCandidates.length === 1 && (!validCandidates[0]!.family.maxBackupChatId || validCandidates[0]!.family.maxBackupChatId === details.chatId ||
              oneFamilyOldUnavailable?.familyId === validCandidates[0]!.familyId && oneFamilyOldUnavailable.oldChatId === validCandidates[0]!.family.maxBackupChatId)) {
            const candidate = validCandidates[0]!
            if (oneFamilyOldUnavailable?.familyId === candidate.familyId && oneFamilyOldUnavailable.oldChatId === candidate.family.maxBackupChatId) {
              const old = await tx.maxChannelBinding.findUnique({ where: { chatId: oneFamilyOldUnavailable.oldChatId } })
              if ((old?.version ?? 0) !== oneFamilyOldUnavailable.oldVersion || (old?.state ?? null) !== oneFamilyOldUnavailable.oldState) throw new Error('MAX channel binding changed during permissions preflight')
              if (old) await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'permission_problem', version: { increment: 1 }, lastProviderCheckAt: now() } })
              await tx.family.updateMany({ where: { id: candidate.familyId, maxBackupChatId: oneFamilyOldUnavailable.oldChatId }, data: { maxBackupChatId: null } })
              await detachUnsentBackups(tx, candidate.familyId, oneFamilyOldUnavailable.oldChatId)
            }
            await bindMaxChannelAndQueue(tx, candidate.familyId, details.chatId, saved.version)
            await tx.maxChannelBinding.update({ where: { chatId: details.chatId }, data: { familyId: candidate.familyId } })
            await tx.maxChannelDecision.update({ where: { id: decision.id }, data: { status: 'completed', expectedChannelVersion: saved.version } })
            await createSimpleResponse(tx, inboxId, decision.actorSubject, `Канал ${verified.title ? `“${verified.title}”` : ''} подключён к семье “${candidate.family.name}”.`)
          } else {
            const replace = validCandidates.length === 1 && oneFamilyReplacement?.familyId === validCandidates[0]!.familyId &&
              validCandidates[0]!.family.maxBackupChatId === oneFamilyReplacement.oldChatId ? oneFamilyReplacement : null
            await tx.maxChannelDecision.update({ where: { id: decision.id }, data: {
              candidateFamilyIds: validCandidates.map((item) => item.familyId), expectedChannelVersion: saved.version,
              expectedActiveChatId: replace?.oldChatId ?? null, expectedActiveVersion: replace?.oldVersion ?? 0,
              ...(replace ? { selectedFamilyId: replace.familyId, phase: 'confirm_replacement' } : { selectedFamilyId: null, phase: 'select_family' }),
            } })
            if (replace) await createDecisionResponse(tx, inboxId, decision.actorSubject, decision.id,
              `Заменить ${replace.oldTitle ? `“${replace.oldTitle}”` : 'текущий канал'} на ${verified.title ? `“${verified.title}”` : 'новый канал'}?`, [], now(), [
                { text: 'Заменить', payload: `max_channel:${decision.id}:replace:0` }, { text: 'Отмена', payload: `max_channel:${decision.id}:cancel:0` },
              ])
            else await createDecisionResponse(tx, inboxId, decision.actorSubject, decision.id,
              'К какой семье относится этот канал?', validCandidates.map((item) => ({ id: item.familyId, name: item.family.name })), now())
          }
          lifecycleResult = await readLifecycleResult(tx, details.chatId)
          await finishInbox(tx, inboxId)
          return
        }
        const trustedActorSubject = event.kind === 'bot_added' ? details.actorSubject : ''
        const identity = trustedActorSubject
          ? await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'max', subject: trustedActorSubject } }, select: { userId: true } })
          : null
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
        const currentActor = candidate ? await lockCurrentFullActorFamily(tx, trustedActorSubject, candidate.familyId) : null
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
      lifecycleResult = await readLifecycleResult(tx, details.chatId)
      await finishInbox(tx, inboxId)
    })
    console.info('MAX channel lifecycle', {
      kind: event.kind, inboxId, channelId: details.chatId.toString(), state: lifecycleResult?.state ?? 'missing',
      familyAssociated: lifecycleResult?.familyAssociated ?? false, decisionCategory: lifecycleResult?.decisionCategory ?? 'none',
    })
  }

  async function processCallback(inboxId: string, event: Callback) {
    const match = /^max_channel:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(select|connect|replace|cancel):([0-9]{1,15})$/i.exec(event.payload)
    if (!match) return false
    const decisionId = match[1]!
    const action = match[2]!
    const index = Number(match[3])
    const initial = await options.prisma.maxChannelDecision.findUnique({ where: { id: decisionId } })
    if (initial && ['confirm_actor_connection', 'confirm_actor_replacement'].includes(initial.phase)) {
      return processActorRecoveryCallback(inboxId, event, decisionId, action, initial)
    }
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

  async function offerActorChannelConnection(input: { inboxId: string; actorSubject: string; actorUserId: string; familyId: string; chatId: bigint }) {
    if (!options.verifyActorAdmin) return false
    let title: string | null
    try {
      const verified = await options.verifyChannel(input.chatId)
      if (!(await options.verifyActorAdmin(input.chatId, BigInt(input.actorSubject)))) return false
      title = verified.title
    } catch (error) {
      if (error instanceof MaxChannelProviderError && error.permanentAccessLoss) return false
      throw error
    }
    return options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const current = await lockCurrentFullActorFamily(tx, input.actorSubject, input.familyId)
      if (!current || current.userId !== input.actorUserId) return false
      const prior = await tx.maxChannelDecision.findUnique({ where: { originInboxId: input.inboxId } })
      if (prior) return prior.actorSubject === input.actorSubject && prior.actorUserId === input.actorUserId && prior.chatId === input.chatId && prior.selectedFamilyId === input.familyId && prior.phase.startsWith('confirm_actor_') && prior.status === 'pending' && prior.expiresAt > now()
      const family = await tx.family.findUnique({ where: { id: input.familyId }, select: { name: true, maxBackupChatId: true } })
      if (!family) return false
      const occupied = await tx.family.findFirst({ where: { maxBackupChatId: input.chatId, id: { not: input.familyId } }, select: { id: true } })
      if (occupied) return false
      const existing = await tx.maxChannelBinding.findUnique({ where: { chatId: input.chatId } })
      if (existing?.familyId && existing.familyId !== input.familyId) return false
      const binding = existing ?? await tx.maxChannelBinding.create({ data: { chatId: input.chatId, familyId: null, title, state: 'connected', version: 1, lastLifecycleAt: null } })
      if (!['connected', 'disconnected', 'permission_problem'].includes(binding.state) || (existing && existing.familyId !== null && existing.familyId !== input.familyId)) return false
      if (existing && existing.familyId === null && (existing.title !== title || existing.state !== 'connected')) {
        await tx.maxChannelBinding.update({ where: { chatId: input.chatId }, data: { title, state: 'connected', version: { increment: 1 } } })
        binding.version += 1
      }
      const decision = await tx.maxChannelDecision.create({ data: {
        originInboxId: input.inboxId, actorSubject: input.actorSubject, actorUserId: input.actorUserId, chatId: input.chatId,
        candidateFamilyIds: [input.familyId], selectedFamilyId: input.familyId,
        expectedChannelVersion: binding.version, expectedActiveChatId: family.maxBackupChatId,
        expectedActiveVersion: family.maxBackupChatId === null ? 0 : (await tx.maxChannelBinding.findUnique({ where: { chatId: family.maxBackupChatId }, select: { version: true } }))?.version ?? 0,
        phase: 'confirm_actor_connection', status: 'pending', expiresAt: new Date(now().getTime() + expiresInMs),
      } })
      const priorChoice = await tx.maxOutgoingResponse.findUnique({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'family_choice' } }, select: { id: true } })
      const recoveryKind = priorChoice ? 'welcome' : 'family_choice'
      if (priorChoice && await tx.maxOutgoingResponse.findUnique({ where: { inboxId_kind: { inboxId: input.inboxId, kind: 'welcome' } }, select: { id: true } })) {
        throw new Error('MAX recovery response slot is already occupied')
      }
      await createDecisionResponse(tx, input.inboxId, input.actorSubject, decision.id,
        `Подключить канал ${title ? `“${title}”` : ''} к семье “${family.name}”?`, [], now(), [
          { text: 'Подключить', payload: `max_channel:${decision.id}:connect:0` },
          { text: 'Отмена', payload: `max_channel:${decision.id}:cancel:0` },
        ], recoveryKind)
      return true
    })
  }

  async function processActorRecoveryCallback(inboxId: string, event: Callback, decisionId: string, action: string, decision: any) {
    if (!['connect', 'replace', 'cancel'].includes(action) || decision.actorSubject !== event.userId || decision.status !== 'pending' || decision.expiresAt <= now()) {
      await options.prisma.$transaction((tx) => finishInbox(tx, inboxId)); return true
    }
    let verified: { title: string | null } | null = null
    let actorAdmin = false
    let oldCheck: { chatId: bigint; version: number; state: string; available: boolean } | null = null
    if (action !== 'cancel') {
      if (!options.verifyActorAdmin) { await options.prisma.$transaction((tx) => finishInbox(tx, inboxId)); return true }
      try {
        verified = await options.verifyChannel(decision.chatId)
        actorAdmin = await options.verifyActorAdmin(decision.chatId, BigInt(decision.actorSubject))
        if (!actorAdmin) { await options.prisma.$transaction((tx) => finishInbox(tx, inboxId)); return true }
        if (decision.expectedActiveChatId !== null && decision.expectedActiveChatId !== decision.chatId) {
          const old = await options.prisma.maxChannelBinding.findUnique({ where: { chatId: decision.expectedActiveChatId } })
          if (old?.state === 'connected') {
            try { await options.verifyChannel(old.chatId); oldCheck = { chatId: old.chatId, version: old.version, state: old.state, available: true } }
            catch (error) {
              if (!(error instanceof MaxChannelProviderError) || !error.permanentAccessLoss) throw error
              oldCheck = { chatId: old.chatId, version: old.version, state: old.state, available: false }
            }
          } else oldCheck = { chatId: decision.expectedActiveChatId, version: old?.version ?? 0, state: old?.state ?? 'missing', available: false }
        }
      } catch (error) {
        if (error instanceof MaxChannelProviderError && error.permanentAccessLoss) { await options.prisma.$transaction((tx) => finishInbox(tx, inboxId)); return true }
        throw error
      }
    }
    await options.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const locked = await tx.maxChannelDecision.findUnique({ where: { id: decisionId } })
      if (!locked || locked.status !== 'pending' || locked.actorSubject !== event.userId || locked.expiresAt <= now()) { await finishInbox(tx, inboxId); return }
      const familyId = locked.selectedFamilyId
      const binding = await tx.maxChannelBinding.findUnique({ where: { chatId: locked.chatId } })
      if (!familyId || !binding || binding.version !== locked.expectedChannelVersion || binding.familyId !== null && binding.familyId !== familyId) { await finishInbox(tx, inboxId); return }
      if (action === 'cancel') {
        await tx.maxChannelDecision.update({ where: { id: decisionId }, data: { status: 'cancelled' } }); await finishInbox(tx, inboxId); return
      }
      if (!actorAdmin || !verified || (await lockCurrentFullActorFamily(tx, locked.actorSubject, familyId))?.userId !== locked.actorUserId) { await finishInbox(tx, inboxId); return }
      const family = await tx.family.findUnique({ where: { id: familyId }, select: { name: true, maxBackupChatId: true } })
      if (!family || family.maxBackupChatId !== locked.expectedActiveChatId) { await finishInbox(tx, inboxId); return }
      const isAlreadyActiveTarget = locked.expectedActiveChatId === locked.chatId
      const old = locked.expectedActiveChatId === null || isAlreadyActiveTarget ? null : await tx.maxChannelBinding.findUnique({ where: { chatId: locked.expectedActiveChatId } })
      const missingOldPointer = locked.expectedActiveChatId !== null && !isAlreadyActiveTarget && old === null
      if ((isAlreadyActiveTarget ? binding.version : old?.version ?? 0) !== locked.expectedActiveVersion) { await finishInbox(tx, inboxId); return }
      if (action === 'connect' && locked.phase === 'confirm_actor_connection' && locked.expectedActiveChatId !== null && !isAlreadyActiveTarget) {
        if (missingOldPointer) {
          await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: locked.expectedActiveChatId }, data: { maxBackupChatId: null } })
          await detachUnsentBackups(tx, familyId, locked.expectedActiveChatId)
        } else if (old && old.chatId !== locked.chatId) {
        if (old.state === 'connected' && oldCheck?.available && oldCheck.version === old.version) {
          await tx.maxChannelDecision.update({ where: { id: decisionId }, data: { phase: 'confirm_actor_replacement' } })
          await createDecisionResponse(tx, inboxId, event.userId, decisionId,
            `Заменить ${old.title ? `“${old.title}”` : 'текущий канал'} на ${verified.title ? `“${verified.title}”` : 'новый канал'}?`, [], now(), [
              { text: 'Заменить', payload: `max_channel:${decisionId}:replace:0` }, { text: 'Отмена', payload: `max_channel:${decisionId}:cancel:0` },
            ])
          await finishInbox(tx, inboxId); return
        }
          if (oldCheck && !oldCheck.available) {
          if (old.state === 'connected') await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'permission_problem', version: { increment: 1 }, lastProviderCheckAt: now() } })
          await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: old.chatId }, data: { maxBackupChatId: null } })
          await detachUnsentBackups(tx, familyId, old.chatId)
          } else { await finishInbox(tx, inboxId); return }
        }
      } else if (!(action === 'connect' && locked.phase === 'confirm_actor_connection') && !(action === 'replace' && locked.phase === 'confirm_actor_replacement' && old)) {
        await finishInbox(tx, inboxId); return
      }
      if (action === 'replace' && old) {
        if (old.state === 'connected' && (!oldCheck || oldCheck.chatId !== old.chatId || oldCheck.version !== old.version || oldCheck.state !== old.state)) { await finishInbox(tx, inboxId); return }
        if (!['connected', 'permission_problem', 'disconnected'].includes(old.state)) { await finishInbox(tx, inboxId); return }
        await tx.maxChannelBinding.update({ where: { chatId: old.chatId }, data: { state: 'replaced', version: { increment: 1 } } })
        await tx.family.updateMany({ where: { id: familyId, maxBackupChatId: old.chatId }, data: { maxBackupChatId: null } })
        await detachUnsentBackups(tx, familyId, old.chatId)
      }
      await bindMaxChannelAndQueue(tx, familyId, locked.chatId, binding.version)
      await tx.maxChannelBinding.update({ where: { chatId: locked.chatId }, data: { familyId, state: 'connected', title: verified.title, version: { increment: 1 } } })
      await tx.maxChannelDecision.update({ where: { id: decisionId }, data: { status: 'completed' } })
      await createSimpleResponse(tx, inboxId, event.userId, `Канал ${verified.title ? `“${verified.title}” ` : ''}подключён к семье “${family.name}”. Перешлите запись ещё раз.`)
      await finishInbox(tx, inboxId)
    })
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

  return { processLifecycle, processCallback, offerActorChannelConnection, status }
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

async function readLifecycleResult(tx: any, chatId: bigint, categoryOverride?: string) {
  const binding = await tx.maxChannelBinding.findUnique({ where: { chatId }, select: { state: true, familyId: true } })
  const decision = await tx.maxChannelDecision.findFirst({ where: { chatId }, orderBy: { updatedAt: 'desc' }, select: { phase: true, status: true } })
  const decisionCategory = categoryOverride ?? (decision?.status === 'completed' ? 'bound'
    : decision?.status === 'cancelled' ? 'cancelled'
    : decision?.phase === 'await_permissions' ? 'await_permissions'
    : decision?.phase === 'confirm_replacement' ? 'replacement_confirmation'
    : decision?.phase === 'select_family' ? 'family_selection'
    : decision?.phase?.startsWith('confirm_actor_') ? 'actor_confirmation'
    : 'none')
  return { state: binding?.state ?? 'missing', familyAssociated: binding?.familyId !== null && binding?.familyId !== undefined, decisionCategory }
}

async function createDecisionResponse(tx: any, inboxId: string, actorSubject: string, decisionId: string, text: string,
  candidates: Array<{ id: string; name: string }>, scheduledFor: Date, buttons?: Array<{ text: string; payload: string }>, kind: 'family_choice' | 'welcome' = 'family_choice') {
  const selectionButtons = candidates.map((item, index) => ({ text: item.name.slice(0, 64), payload: `max_channel:${decisionId}:select:${index}` }))
  const response = await tx.maxOutgoingResponse.create({ data: {
    inboxId, channelDecisionId: decisionId, destinationUserId: BigInt(actorSubject), kind,
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
