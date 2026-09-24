export function shouldCheckForNew({ checking, hidden }: { checking: boolean; hidden: boolean }) {
  return !checking && !hidden
}

export function shouldRefreshInitialEmptyFeed({ knownFirstId, latestFirstId }: {
  knownFirstId: string | null
  latestFirstId: string | null
}) {
  return knownFirstId === null && latestFirstId !== null
}

export async function refreshFromTop(
  refetch: () => Promise<{ isError?: boolean; data?: { pages: Array<{ items: MemoryDto[] }> } }>,
  knownFirstId: { current: string | null },
  isCurrent: () => boolean,
  clearNewAvailable: () => void,
): Promise<boolean> {
  try {
    const result = await refetch()
    if (!isCurrent() || result.isError || !result.data) return false
    knownFirstId.current = result.data.pages[0]?.items[0]?.id ?? knownFirstId.current
    clearNewAvailable()
    return true
  } catch {
    return false
  }
}
import type { MemoryDto } from '@web-app-demo/contracts'
