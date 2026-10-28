import { loadEnv } from '../src/env'
import { createPrisma } from '../src/db'
import { notificationAudience, notificationRecipients } from '../src/max-notifications-pilot'
import { createMaxApi } from '../src/modules/max'

// Read-only by default. The sole optional mutation preserves the configured subscription and
// adds stop events. No test message, family data, identity value or secret is printed.
async function main() {
  if (Bun.argv.slice(2).some((arg) => arg !== '--subscribe-stops')) throw new Error('Unsupported pilot command')
  const env = loadEnv(Bun.env)
  const audience = notificationAudience(env)
  if (!env.MAX_ENABLED || !env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_URL || !env.MAX_WEBHOOK_SECRET ||
      !env.MAX_BOT_EXPECTED_USERNAME || audience === 'owner' && env.CONTROL_OWNER_USER_IDS.length !== 1) throw new Error('Notification protected configuration is not unambiguous')
  const db = createPrisma(env.DATABASE_URL)
  try {
    const identities = audience === 'owner' ? await db.externalIdentity.findMany({ where: { provider: 'max', userId: env.CONTROL_OWNER_USER_IDS[0] }, select: { subject: true } }) : []
    if (audience === 'owner' && identities.length !== 1) throw new Error('Pilot owner MAX identity is not unambiguous')
    const api = createMaxApi(env.MAX_BOT_TOKEN)
    const bot = await api.getMe()
    if (!bot.isBot || bot.username.toLowerCase() !== env.MAX_BOT_EXPECTED_USERNAME.toLowerCase()) throw new Error('Pilot bot identity mismatch')
    const subscriptions = (await api.getSubscriptions()).filter(({ url }) => url === env.MAX_WEBHOOK_URL)
    if (subscriptions.length !== 1) throw new Error('Pilot webhook subscription is not unambiguous')
    const subscription = subscriptions[0]!
    let stopSubscribed = subscription.updateTypes === null || subscription.updateTypes.includes('bot_stopped')
    if (!stopSubscribed && Bun.argv.includes('--subscribe-stops')) {
      const result = await api.createSubscription({ url: env.MAX_WEBHOOK_URL,
        secret: env.MAX_WEBHOOK_SECRET, updateTypes: [...subscription.updateTypes!, 'bot_stopped'] })
      if (!result.success) throw new Error('Pilot stop subscription was not accepted')
      const verified = (await api.getSubscriptions()).filter(({ url }) => url === env.MAX_WEBHOOK_URL)
      stopSubscribed = verified.length === 1 && (verified[0]!.updateTypes === null || verified[0]!.updateTypes!.includes('bot_stopped'))
    }
    if (!stopSubscribed) throw new Error('Pilot requires the bot_stopped webhook subscription')
    const members = await db.familyMember.findMany({ where: { ...(audience === 'owner' ? { userId: env.CONTROL_OWNER_USER_IDS[0] } : {}),
      revokedAt: null, family: { status: 'active' }, user: { controlState: 'active' } }, select: { familyId: true }, distinct: ['familyId'] })
    let eligibleFamilies = 0
    let eligibleRecipients = 0
    for (const member of members) {
      const recipients = await db.$transaction((tx) => notificationRecipients(tx, { ...env,
        MAX_NOTIFICATIONS_PILOT_SUBJECT: env.MAX_NOTIFICATIONS_PILOT_SUBJECT ?? identities[0]?.subject,
        MAX_NOTIFICATIONS_PILOT_ENABLED: true, MAX_NOTIFICATIONS_PILOT_SINCE: new Date().toISOString() }, member.familyId))
      const eligible = recipients.filter((recipient) => recipient.botId === String(bot.userId)).length
      if (eligible) eligibleFamilies++
      eligibleRecipients += eligible
    }
    if (!eligibleFamilies) throw new Error('Pilot owner has no eligible active family and bot engagement')
    console.log(JSON.stringify({ audience, ...(audience === 'owner' ? { ownerIdentityVerified: true } : {}), botVerified: true, stopSubscribed, eligibleFamilies, eligibleRecipients,
      pilotEnabled: env.MAX_NOTIFICATIONS_PILOT_ENABLED, activationConfigured: Boolean(env.MAX_NOTIFICATIONS_PILOT_SINCE) }))
  } finally { await db.$disconnect() }
}

main().catch(() => { console.error('MAX pilot preflight failed; check protected configuration, identity, engagement and subscription. No message sent.'); process.exitCode = 1 })
