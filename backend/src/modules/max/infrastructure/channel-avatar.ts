import type { DbClient } from '../../../db'
import type { FamilyScope, FamilyAccess } from '../../families'
import { createMaxPosterDownload, type MaxDownloadedMedia } from './media-download'

const maxBytes = 1_048_576
const positiveTtlMs = 60_000
const negativeTtlMs = 15_000
const maxEntries = 32

type AvatarValue = MaxDownloadedMedia | null
type CacheEntry = { expiresAt: number; value: AvatarValue }

/** Read-only channel icon proxy with a short family, binding-version scoped cache. */
export function createMaxChannelAvatarReader(options: {
  db: DbClient
  familyAccess: FamilyAccess
  getAvatarUrl: (chatId: bigint) => Promise<string | null>
  download?: (url: string, maxBytes: number, signal?: AbortSignal) => Promise<MaxDownloadedMedia>
  now?: () => number
}) {
  const download = options.download ?? createMaxPosterDownload()
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<AvatarValue>>()

  async function binding(scope: FamilyScope, chatId: bigint) {
    await options.familyAccess.requireMember(scope)
    return options.db.maxChannelBinding.findFirst({
      where: { chatId, familyId: scope.familyId },
      select: { chatId: true, familyId: true, version: true },
    })
  }

  return async function read(scope: FamilyScope, chatId: bigint, _signal?: AbortSignal): Promise<AvatarValue> {
    const current = await binding(scope, chatId)
    if (!current) return null
    const key = `${scope.familyId}:${chatId.toString()}:${current.version}`
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now()) {
      const rechecked = await binding(scope, chatId)
      return rechecked?.version === current.version ? cached.value : null
    }
    if (cached) cache.delete(key)

    let pending = inFlight.get(key)
    if (!pending) {
      if (inFlight.size >= maxEntries) return null
      pending = (async () => {
        let value: AvatarValue = null
        try {
          const url = await options.getAvatarUrl(chatId)
          if (url) value = await download(url, maxBytes)
        } catch { value = null }
        cache.set(key, { value, expiresAt: now() + (value ? positiveTtlMs : negativeTtlMs) })
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string)
        return value
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    const value = await pending
    const rechecked = await binding(scope, chatId)
    return rechecked?.version === current.version ? value : null
  }
}
