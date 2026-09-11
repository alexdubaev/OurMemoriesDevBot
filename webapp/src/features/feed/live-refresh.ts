export function shouldCheckForNew({ checking, hidden }: { checking: boolean; hidden: boolean }) {
  return !checking && !hidden
}

export function shouldRefreshInitialEmptyFeed({ knownFirstId, latestFirstId }: {
  knownFirstId: string | null
  latestFirstId: string | null
}) {
  return knownFirstId === null && latestFirstId !== null
}
