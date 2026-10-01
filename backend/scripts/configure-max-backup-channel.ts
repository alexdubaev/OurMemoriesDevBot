import 'dotenv/config'

import { createPrisma, type DbClient } from '../src/db'
import { createMaxChannelProvider } from '../src/modules/max/infrastructure/max-channel-provider'
import { bindMaxChannelAndQueue } from '../src/modules/max/application/channel-onboarding'

const MAX_INT64_MIN = -9_223_372_036_854_775_808n
const MAX_INT64_MAX = 9_223_372_036_854_775_807n

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type MaxBackupChannelApi = {
  verifyBot(expectedUsername: string): Promise<void>
  verifyChannel(chatId: bigint): Promise<void>
}

export type MaxBackupChannelRepository = {
  bindAndQueue(familyId: string, chatId: bigint): Promise<{ queued: number }>
}

export function createMaxBackupChannelApi(token: string, options: { fetch?: FetchLike } = {}): MaxBackupChannelApi {
  const provider = createMaxChannelProvider(token, options)
  return {
    verifyBot: provider.verifyBot,
    verifyChannel: async (chatId) => { await provider.verifyChannel(chatId) },
  }
}

export function createPrismaMaxBackupChannelRepository(prisma: DbClient): MaxBackupChannelRepository {
  return {
    async bindAndQueue(familyId, chatId) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(7341288911)`
        const binding = await tx.maxChannelBinding.findUnique({ where: { chatId } })
        if (binding?.familyId && binding.familyId !== familyId) throw new Error('MAX channel is already bound to another family')
        await tx.$queryRaw`SELECT id FROM families WHERE id = ${familyId}::uuid FOR UPDATE`
        const family = await tx.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } })
        if (!family) throw new Error('Family does not exist')
        if (family.maxBackupChatId !== null && family.maxBackupChatId !== chatId) throw new Error('Family is already bound to a different MAX channel')
        const history = await tx.maxChannelBinding.upsert({
          where: { chatId },
          create: { chatId, familyId, state: 'connected', version: 1 },
          update: { familyId, state: 'connected', version: { increment: 1 } },
          select: { version: true },
        })
        const update = await bindMaxChannelAndQueue(tx, familyId, chatId, history.version)
        return { queued: update }
      })
    },
  }
}

export function parseMaxBackupChannelArgs(args: readonly string[]) {
  let familyId: string | undefined
  let rawChatId: string | undefined
  let apply = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--apply') {
      if (apply) throw new Error('Duplicate --apply')
      apply = true
    } else if (arg === '--family') {
      if (familyId || !args[index + 1]) throw new Error('Expected one family UUID after --family')
      familyId = args[++index]
    } else if (arg === '--chat-id') {
      if (rawChatId || !args[index + 1]) throw new Error('Expected one non-zero signed int64 chat ID after --chat-id')
      rawChatId = args[++index]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!familyId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId)) {
    throw new Error('--family must be an existing family UUID')
  }
  if (!rawChatId || !/^-?[1-9][0-9]{0,18}$/.test(rawChatId)) throw new Error('--chat-id must be a non-zero signed int64')
  const chatId = BigInt(rawChatId)
  if (chatId < MAX_INT64_MIN || chatId > MAX_INT64_MAX) throw new Error('--chat-id must be a non-zero signed int64')
  return { familyId, chatId, apply }
}

export async function configureMaxBackupChannel(options: {
  familyId: string
  chatId: bigint
  apply: boolean
  expectedBotUsername: string
  api: MaxBackupChannelApi
  repository: MaxBackupChannelRepository
}) {
  await options.api.verifyBot(options.expectedBotUsername)
  await options.api.verifyChannel(options.chatId)
  if (!options.apply) return { applied: false as const, queued: null }
  const result = await options.repository.bindAndQueue(options.familyId, options.chatId)
  return { applied: true as const, queued: result.queued }
}

async function main() {
  let parsed: ReturnType<typeof parseMaxBackupChannelArgs>
  try {
    parsed = parseMaxBackupChannelArgs(Bun.argv.slice(2))
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : 'Invalid arguments'}\nUsage: bun scripts/configure-max-backup-channel.ts --family <uuid> --chat-id <signed-int64> [--apply]`)
    process.exitCode = 2
    return
  }

  const token = Bun.env.MAX_BOT_TOKEN
  const expectedUsername = Bun.env.MAX_BOT_EXPECTED_USERNAME
  if (!token || !expectedUsername) throw new Error('MAX bot configuration is incomplete')
  const api = createMaxBackupChannelApi(token)
  const prisma = parsed.apply
    ? createPrisma(Bun.env.DATABASE_URL ?? '')
    : undefined
  try {
    const outcome = await configureMaxBackupChannel({
      ...parsed,
      expectedBotUsername: expectedUsername,
      api,
      repository: prisma ? createPrismaMaxBackupChannelRepository(prisma) : { bindAndQueue: async () => { throw new Error('Database writes are disabled in dry-run mode') } },
    })
    if (outcome.applied) console.log(`Configured family ${parsed.familyId} for MAX channel ${parsed.chatId}; queued ${outcome.queued} backup(s).`)
    else console.log(`Verified MAX channel ${parsed.chatId} for family ${parsed.familyId}. Dry run only; pass --apply to bind and queue backups.`)
  } finally {
    await prisma?.$disconnect()
  }
}

if (import.meta.main) {
  try {
    await main()
  } catch {
    // Provider/DB exceptions can contain request or connection metadata. Keep CLI failures sanitized.
    console.error('MAX backup channel provisioning failed; details were suppressed to protect credentials.')
    process.exitCode = 1
  }
}
