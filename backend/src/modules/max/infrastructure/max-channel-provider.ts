const BASE = 'https://platform-api2.max.ru'
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

import { MaxChannelProviderError, readMaxInt64AtPath, readMaxRootInt64 } from '../application/channel-protocol'
export { MaxChannelProviderError, readMaxRootInt64 } from '../application/channel-protocol'

export type MaxVerifiedChannel = { chatId: bigint; title: string | null }

/** One verifier shared by provisioning and lifecycle onboarding. */
export function createMaxChannelProvider(token: string, options: { fetch?: FetchLike } = {}) {
  if (!token) throw new Error('MAX_BOT_TOKEN is required')
  const fetcher = options.fetch ?? fetch
  async function get(path: string) {
    let response: Response
    try {
      response = await fetcher(`${BASE}${path}`, { method: 'GET', headers: { Authorization: token }, redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    } catch { throw new MaxChannelProviderError(null) }
    if (!response.ok) throw new MaxChannelProviderError(response.status)
    const raw = await response.text()
    let value: unknown
    try { value = JSON.parse(raw) } catch { throw new MaxChannelProviderError(null) }
    if (!isRecord(value)) throw new MaxChannelProviderError(null)
    return { value, raw }
  }
  return {
    async verifyBot(expectedUsername: string) {
      const { value } = await get('/me')
      if (value.is_bot !== true || value.username !== expectedUsername) throw new MaxChannelProviderError(403, 'MAX bot identity verification failed')
    },
    async verifyChannel(chatId: bigint): Promise<MaxVerifiedChannel> {
      const { value: channel, raw } = await get(`/chats/${chatId}`)
      if (channel.type !== 'channel' || channel.status !== 'active' || channel.is_public !== false || readMaxRootInt64(raw, 'chat_id') !== chatId) {
        throw new MaxChannelProviderError(400, 'MAX target must be an active channel with private visibility')
      }
      const { value: member } = await get(`/chats/${chatId}/members/me`)
      const permissions = member.permissions
      if (member.is_bot !== true || (member.is_owner !== true && member.is_admin !== true) || !Array.isArray(permissions) ||
          (!permissions.includes('write') && !permissions.includes('post_edit_delete_message'))) {
        throw new MaxChannelProviderError(403, 'MAX bot must be a channel owner or admin with write permission')
      }
      return { chatId, title: typeof channel.title === 'string' ? channel.title : null }
    },
    async verifyActorAdmin(chatId: bigint, actorSubject: bigint): Promise<boolean> {
      if (chatId === 0n || actorSubject === 0n) throw new MaxChannelProviderError(400)
      const { value, raw } = await get(`/chats/${chatId}/members/admins`)
      if (!Array.isArray(value.members) || (value.marker !== undefined && value.marker !== null)) throw new MaxChannelProviderError(null, 'MAX administrator response is incomplete')
      const seen = new Set<bigint>()
      let actor: Record<string, unknown> | null = null
      for (let index = 0; index < value.members.length; index += 1) {
        const member = value.members[index]
        if (!isRecord(member)) throw new MaxChannelProviderError(null, 'MAX administrator response is malformed')
        const userId = readMaxInt64AtPath(raw, ['members', index, 'user_id'])
        if (userId === null) throw new MaxChannelProviderError(null, 'MAX administrator ID is malformed')
        if (seen.has(userId)) throw new MaxChannelProviderError(null, 'MAX administrator response contains duplicate IDs')
        seen.add(userId)
        if (userId === actorSubject) actor = member
      }
      return actor !== null && actor.is_bot === false && (actor.is_owner === true || actor.is_admin === true)
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
