import type { BackendRuntime } from '../../runtime'
import type { MaxApiPort } from './application/ports'
import { createMaxApi } from './infrastructure/max-api'
import { createMaxWebhook } from './transport/webhook'

export function createMaxModule(options: {
  runtime: BackendRuntime
  api?: MaxApiPort
  acceptUpdate?: (event: import('./application/ports').MaxInboundEvent) => Promise<unknown>
}) {
  const env = options.runtime.env
  if (!env.MAX_BOT_TOKEN || !env.MAX_WEBHOOK_SECRET) throw new Error('MAX adapter is not configured')
  const api = options.api ?? createMaxApi(env.MAX_BOT_TOKEN)
  const acceptUpdate = options.acceptUpdate ?? (async () => {
    throw new Error('MAX update acceptance is not configured')
  })
  return {
    api,
    routes: createMaxWebhook({
      secret: env.MAX_WEBHOOK_SECRET,
      bodyLimitBytes: env.MAX_WEBHOOK_BODY_LIMIT_BYTES,
      acceptUpdate,
    }),
  }
}

export { createMaxApi, MaxProviderError } from './infrastructure/max-api'
export type { MaxApiPort, MaxBotIdentity, MaxInboundEvent, MaxSubscription, MaxSubscriptionInput } from './application/ports'
