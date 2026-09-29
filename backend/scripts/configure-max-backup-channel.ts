import 'dotenv/config'

import { createPrisma, type DbClient } from '../src/db'
import { insertTask } from '../src/outbox/store'

const MAX_API_BASE = 'https://platform-api2.max.ru'
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
  if (!token) throw new Error('MAX_BOT_TOKEN is required')
  const fetcher = options.fetch ?? fetch

  async function get(path: string): Promise<{ value: Record<string, unknown>; raw: string }> {
    let response: Response
    try {
      response = await fetcher(`${MAX_API_BASE}${path}`, {
        method: 'GET',
        headers: { Authorization: token },
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('MAX verification request failed')
    }
    if (!response.ok) throw new Error('MAX verification request failed')
    let raw: string
    let value: unknown
    try {
      raw = await response.text()
      value = JSON.parse(raw)
    } catch { throw new Error('MAX verification response was invalid') }
    if (!isRecord(value)) throw new Error('MAX verification response was invalid')
    return { value, raw }
  }

  return {
    async verifyBot(expectedUsername) {
      const { value: bot } = await get('/me')
      if (bot.is_bot !== true || bot.username !== expectedUsername) {
        throw new Error('MAX bot identity verification failed')
      }
    },
    async verifyChannel(chatId) {
      const encodedChatId = chatId.toString()
      const { value: chat, raw: chatRaw } = await get(`/chats/${encodedChatId}`)
      if (chat.type !== 'channel' || chat.status !== 'active' || chat.is_public !== false ||
          readRootInt64(chatRaw, 'chat_id') !== chatId) {
        throw new Error('MAX target must be an active channel where the bot is a member')
      }
      const { value: membership } = await get(`/chats/${encodedChatId}/members/me`)
      const permissions = membership.permissions
      if (membership.is_bot !== true || (membership.is_owner !== true && membership.is_admin !== true) ||
          !Array.isArray(permissions) || !permissions.includes('write')) {
        throw new Error('MAX bot must be a channel owner or admin with write permission')
      }
    },
  }
}

export function createPrismaMaxBackupChannelRepository(prisma: DbClient): MaxBackupChannelRepository {
  return {
    async bindAndQueue(familyId, chatId) {
      return prisma.$transaction(async (tx) => {
        const family = await tx.family.findUnique({ where: { id: familyId }, select: { maxBackupChatId: true } })
        if (!family) throw new Error('Family does not exist')
        if (family.maxBackupChatId !== null && family.maxBackupChatId !== chatId) {
          throw new Error('Family is already bound to a different MAX channel')
        }
        const occupied = await tx.family.findFirst({
          where: { maxBackupChatId: chatId, id: { not: familyId } },
          select: { id: true },
        })
        if (occupied) throw new Error('MAX channel is already bound to another family')

        const update = await tx.family.updateMany({
          where: { id: familyId, OR: [{ maxBackupChatId: null }, { maxBackupChatId: chatId }] },
          data: { maxBackupChatId: chatId },
        })
        if (update.count !== 1) throw new Error('Family MAX channel binding changed concurrently')

        const backups = await tx.maxMemoryBackup.updateManyAndReturn({
          where: { familyId, state: 'needs_configuration' },
          data: { channelChatId: chatId, state: 'pending', lastErrorCode: null },
          select: { memoryId: true },
        })
        if (backups.length) {
          for (const backup of backups) {
            await insertTask(tx, {
              type: 'max:backup-media',
              dedupeKey: `max-backup-media:${backup.memoryId}`,
              payload: { memoryId: backup.memoryId },
            })
          }
        }
        return { queued: backups.length }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read an int64 field from the original JSON so IDs above Number.MAX_SAFE_INTEGER remain exact. */
function readRootInt64(raw: string, field: string): bigint | null {
  let index = 0
  const whitespace = () => { while (/\s/.test(raw[index] ?? '')) index += 1 }
  const readStringEnd = (start: number) => {
    let cursor = start + 1
    while (cursor < raw.length) {
      if (raw[cursor] === '\\') cursor += 2
      else if (raw[cursor++] === '"') return cursor
    }
    return -1
  }
  const skipValue = () => {
    if (raw[index] === '"') {
      const end = readStringEnd(index)
      if (end < 0) return false
      index = end
      return true
    }
    if (raw[index] === '{' || raw[index] === '[') {
      const stack = [raw[index++] === '{' ? '}' : ']']
      while (index < raw.length && stack.length) {
        if (raw[index] === '"') {
          const end = readStringEnd(index)
          if (end < 0) return false
          index = end
        } else if (raw[index] === '{' || raw[index] === '[') {
          stack.push(raw[index++] === '{' ? '}' : ']')
        } else if (raw[index] === '}' || raw[index] === ']') {
          if (raw[index++] !== stack.pop()) return false
        } else index += 1
      }
      return stack.length === 0
    }
    while (index < raw.length && raw[index] !== ',' && raw[index] !== '}') index += 1
    return true
  }

  whitespace()
  if (raw[index++] !== '{') return null
  while (index < raw.length) {
    whitespace()
    if (raw[index] === '}') return null
    if (raw[index] !== '"') return null
    const keyEnd = readStringEnd(index)
    if (keyEnd < 0) return null
    let key: unknown
    try { key = JSON.parse(raw.slice(index, keyEnd)) } catch { return null }
    index = keyEnd
    whitespace()
    if (raw[index++] !== ':') return null
    whitespace()
    if (key === field) {
      if (raw[index] === '"') {
        const end = readStringEnd(index)
        if (end < 0) return null
        let value: unknown
        try { value = JSON.parse(raw.slice(index, end)) } catch { return null }
        if (typeof value !== 'string' || !/^-?[1-9][0-9]{0,18}$/.test(value)) return null
        const id = BigInt(value)
        return id >= MAX_INT64_MIN && id <= MAX_INT64_MAX ? id : null
      }
      const match = /^-?[1-9][0-9]{0,18}/.exec(raw.slice(index))
      if (!match) return null
      index += match[0].length
      whitespace()
      if (raw[index] !== ',' && raw[index] !== '}') return null
      const id = BigInt(match[0])
      return id >= MAX_INT64_MIN && id <= MAX_INT64_MAX ? id : null
    }
    if (!skipValue()) return null
    whitespace()
    if (raw[index] === ',') index += 1
    else if (raw[index] !== '}') return null
  }
  return null
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
