export type StartupBootstrapState =
  | { status: 'pending' }
  | { status: 'ready' }

export type StartupRoute = 'boot' | 'hub'

/** Ordinary authorized launches start at the family selector. Explicit links are resolved before this step. */
export function decideStartupRoute(state: StartupBootstrapState): StartupRoute {
  if (state.status === 'pending') return 'boot'
  return 'hub'
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
