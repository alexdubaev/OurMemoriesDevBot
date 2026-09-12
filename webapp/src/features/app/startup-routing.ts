export type StartupBootstrapState =
  | { status: 'pending' }
  | { status: 'ready'; hasActiveFamily: boolean; hasChildProfile: boolean }

export type StartupRoute = 'boot' | 'family' | 'feed'

/** Chooses a start screen once the session and active family have been resolved. */
export function decideStartupRoute(state: StartupBootstrapState): StartupRoute {
  if (state.status === 'pending') return 'boot'
  return state.hasActiveFamily && state.hasChildProfile ? 'feed' : 'family'
}

export function shouldRenderInitialFeedError({
  isAppBootstrapped,
  isFeedError,
  isFeedPending,
  itemCount,
}: {
  isAppBootstrapped: boolean
  isFeedError: boolean
  isFeedPending: boolean
  itemCount: number
}) {
  return isAppBootstrapped && !isFeedPending && isFeedError && itemCount === 0
}
