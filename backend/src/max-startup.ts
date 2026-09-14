import { createMaxApi, createMaxModule, type MaxApiPort } from './modules/max'
import type { BackendRuntime } from './runtime'

type MaxModule = ReturnType<typeof createMaxModule>

export async function startMaxIfEnabled(options: {
  runtime: BackendRuntime
  createApi?: (token: string) => MaxApiPort
  createModule?: typeof createMaxModule
}): Promise<MaxModule | null> {
  const { runtime } = options
  if (!runtime.env.MAX_ENABLED) return null
  try {
    if (!runtime.env.MAX_BOT_TOKEN || !runtime.env.MAX_BOT_EXPECTED_USERNAME) throw new Error('MAX startup configuration is incomplete')
    const api = (options.createApi ?? createMaxApi)(runtime.env.MAX_BOT_TOKEN)
    const identity = await api.getMe()
    if (!identity.isBot || identity.username !== runtime.env.MAX_BOT_EXPECTED_USERNAME) throw new Error('MAX bot identity verification failed')
    return (options.createModule ?? createMaxModule)({ runtime, api })
  } catch {
    try { await runtime.close() } catch { /* preserve the sanitized startup failure */ }
    throw new Error('MAX startup failed')
  }
}
