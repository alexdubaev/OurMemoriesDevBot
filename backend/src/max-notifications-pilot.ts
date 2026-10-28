import { createHash } from 'node:crypto'
import type { AppEnv } from './env'
import type { PrismaTransactionClient } from './idempotency'
import { insertTask } from './outbox/store'

export const pilotTaskType = 'max:notify-pilot'
export type MaxNotificationPilot = Pick<AppEnv, 'MAX_ENABLED' | 'MAX_BOT_EXPECTED_USERNAME' |
  'CONTROL_OWNER_USER_IDS' | 'MAX_NOTIFICATIONS_PILOT_ENABLED' | 'MAX_NOTIFICATIONS_PILOT_SINCE' | 'MAX_NOTIFICATIONS_PILOT_SUBJECT'> &
  Partial<Pick<AppEnv, 'MAX_NOTIFICATIONS_AUDIENCE'>>
export type PilotEvent = { familyId: string } & (
  | { kind: 'album'; albumId: string; entryId: string; eventId: string; photoCount: number }
  | { kind: 'feed'; memoryId: string }
)

export function pilotEnabled(config?: MaxNotificationPilot): config is MaxNotificationPilot & { MAX_NOTIFICATIONS_PILOT_SINCE: string; MAX_BOT_EXPECTED_USERNAME: string } {
  return Boolean(config?.MAX_ENABLED && config.MAX_NOTIFICATIONS_PILOT_ENABLED &&
    config.MAX_BOT_EXPECTED_USERNAME &&
    (notificationAudience(config) === 'family' || config.CONTROL_OWNER_USER_IDS.length === 1 &&
      config.MAX_NOTIFICATIONS_PILOT_SUBJECT && /^[1-9][0-9]{0,18}$/.test(config.MAX_NOTIFICATIONS_PILOT_SUBJECT)) &&
    /^[A-Za-z0-9_]{5,32}$/.test(config.MAX_BOT_EXPECTED_USERNAME) &&
    config.MAX_NOTIFICATIONS_PILOT_SINCE && Number.isFinite(Date.parse(config.MAX_NOTIFICATIONS_PILOT_SINCE)) &&
    Date.parse(config.MAX_NOTIFICATIONS_PILOT_SINCE) <= Date.now())
}

export function notificationAudience(config: MaxNotificationPilot) {
  return config.MAX_NOTIFICATIONS_AUDIENCE ?? 'owner'
}

/** Revalidates one exact identity; family mode never resolves a queued task to a different user. */
export async function pilotRecipient(tx: PrismaTransactionClient, config: MaxNotificationPilot, familyId: string, identityId?: string) {
  if (!pilotEnabled(config)) return null
  const audience = notificationAudience(config)
  if (audience === 'family' && !identityId) return null
  const target = audience === 'family'
    ? await tx.externalIdentity.findFirst({ where: { id: identityId, provider: 'max' }, select: { userId: true } })
    : { userId: config.CONTROL_OWNER_USER_IDS[0]! }
  if (!target) return null
  const identities = await tx.externalIdentity.findMany({ where: { userId: target.userId, provider: 'max' },
    select: { id: true, userId: true, subject: true } })
  const identity = identities.length === 1 ? identities[0] : null
  if (!identity || identityId && identity.id !== identityId || audience === 'owner' && identity.subject !== config.MAX_NOTIFICATIONS_PILOT_SUBJECT ||
    !/^[1-9][0-9]{0,18}$/.test(identity.subject) || BigInt(identity.subject) > 9_223_372_036_854_775_807n) return null
  const member = await tx.familyMember.findFirst({ where: { familyId, userId: identity.userId, revokedAt: null,
    family: { status: 'active' }, user: { controlState: 'active' } }, select: { membershipEpoch: true } })
  if (!member) return null
  // Successful bot-start welcome is existing, server-authoritative engagement evidence.
  const welcomes = await tx.maxOutgoingResponse.findMany({ where: { destinationUserId: BigInt(identity.subject), kind: 'welcome',
    deliveredAt: { not: null }, inbox: { eventKind: 'bot_started', status: 'processed' } },
    select: { buttons: true, createdAt: true, inbox: { select: { botId: true } } }, orderBy: { createdAt: 'desc' } })
  for (const welcome of welcomes) {
    const marker = welcome.buttons as { pilotStartedAt?: string } | null
    const startedAt = marker?.pilotStartedAt ? new Date(marker.pilotStartedAt) : welcome.createdAt
    if (!Number.isFinite(startedAt.getTime())) continue
    const stops = await tx.maxInbox.findMany({ where: { botId: welcome.inbox.botId, eventKind: 'bot_stopped',
      eventKey: { startsWith: pilotStopPrefix(welcome.inbox.botId.toString(), identity.subject) } }, select: { eventKey: true } })
    if (stops.some(({ eventKey }) => Date.parse(eventKey.slice(eventKey.lastIndexOf('|') + 1)) >= startedAt.getTime())) return null
    return { ...identity, membershipEpoch: member.membershipEpoch, botId: welcome.inbox.botId.toString() }
  }
  return null
}

/** Only members of the event's family; no global user list or historic event expansion. */
export async function notificationRecipients(tx: PrismaTransactionClient, config: MaxNotificationPilot, familyId: string) {
  if (!pilotEnabled(config)) return []
  if (notificationAudience(config) === 'owner') {
    const recipient = await pilotRecipient(tx, config, familyId)
    return recipient ? [recipient] : []
  }
  const identities = await tx.externalIdentity.findMany({ where: { provider: 'max', user: { controlState: 'active',
    familyMemberships: { some: { familyId, revokedAt: null, family: { status: 'active' } } } } },
    select: { id: true }, orderBy: { id: 'asc' } })
  const recipients = []
  for (const identity of identities) {
    const recipient = await pilotRecipient(tx, config, familyId, identity.id)
    if (recipient) recipients.push(recipient)
  }
  return recipients
}

export function pilotStopPrefix(botId: string, subject: string) {
  return `pilot-stop:${createHash('sha256').update(`${botId}:${subject}`).digest('hex')}|`
}

/** Called only inside the actual album/publication transaction; OFF never creates historical work. */
export async function enqueuePilotNotification(tx: PrismaTransactionClient, config: MaxNotificationPilot | undefined, event: PilotEvent) {
  if (!pilotEnabled(config) || event.kind === 'album' && event.photoCount < 1) return
  const recipients = await notificationRecipients(tx, config, event.familyId)
  const eventKey = event.kind === 'feed' ? `feed:${event.familyId}:${event.memoryId}` : `album:${event.familyId}:${event.albumId}:${event.entryId}:${event.eventId}`
  const audience = notificationAudience(config)
  for (const recipient of recipients) await insertTask(tx, { type: pilotTaskType,
    dedupeKey: audience === 'family' ? `${eventKey}:recipient:${recipient.id}` : eventKey,
    payload: { ...event, identityId: recipient.id, subjectHash: pilotSubjectHash(recipient.subject), membershipEpoch: recipient.membershipEpoch, botId: recipient.botId,
      audience, pilotSince: config.MAX_NOTIFICATIONS_PILOT_SINCE } })
}

export function pilotSubjectHash(subject: string) {
  return createHash('sha256').update(subject).digest('hex')
}

export function albumNotificationText(title: string, count: number) {
  const safeTitle = [...title.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/[«»„“”]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 100).join('') || 'Семейный альбом'
  if (count === 1) return `Новое фото в альбоме «${safeTitle}» 📸`
  const one = count % 10 === 1 && count % 100 !== 11
  return `В альбоме «${safeTitle}» — ${count} ${one ? 'новое' : 'новых'} фото 📸`
}
