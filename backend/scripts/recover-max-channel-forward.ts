import { createBackendRuntime } from '../src/runtime'
import { createMaxApi } from '../src/modules/max/infrastructure/max-api'
import { createMaxPayloadCrypto } from '../src/modules/max/infrastructure/payload-crypto'
import { planMaxChannelForwardRecovery, queueMaxChannelForwardRecovery } from '../src/modules/max/infrastructure/channel-forward-recovery'

const [mode, sourceId, fingerprint, ...extra] = process.argv.slice(2)
if (!['plan', 'apply'].includes(mode ?? '') || !/^[0-9a-f-]{36}$/.test(sourceId ?? '') || extra.length ||
    (mode === 'plan' && fingerprint !== undefined) || (mode === 'apply' && !/^[a-f0-9]{64}$/.test(fingerprint ?? ''))) {
  throw new Error('Usage: recover-max-channel-forward.ts plan SOURCE_UUID | apply SOURCE_UUID PLAN_SHA256')
}
const runtime = createBackendRuntime()
try {
  if (!runtime.env.MAX_ENABLED || !runtime.env.MAX_BOT_TOKEN || !runtime.env.MAX_INBOX_ENCRYPTION_KEY) throw new Error('MAX is not configured')
  const api = createMaxApi(runtime.env.MAX_BOT_TOKEN)
  const bot = await api.getMe()
  if (!bot.isBot || bot.username !== runtime.env.MAX_BOT_EXPECTED_USERNAME) throw new Error('Configured MAX bot identity differs')
  const options = { db: runtime.prisma, api, botId: String(bot.userId) }
  if (mode === 'plan') {
    const plan = await planMaxChannelForwardRecovery(options, sourceId!)
    console.log(JSON.stringify({ eligible: true, sourceId, fingerprint: plan.fingerprint }))
  } else {
    const result = await queueMaxChannelForwardRecovery({ ...options,
      encrypt: createMaxPayloadCrypto(runtime.env.MAX_INBOX_ENCRYPTION_KEY).encrypt }, sourceId!, fingerprint!)
    console.log(JSON.stringify({ sourceId, ...result }))
  }
} catch (error) {
  // Provider errors may contain URLs; only safe type/status information is emitted.
  console.error(JSON.stringify({ failed: true, error: error instanceof Error ? error.name : 'Error' }))
  process.exitCode = 1
} finally {
  await runtime.close()
}
