import type { HostBridge } from './host-bridge'

export type ReactionHapticStyle = 'light' | 'soft'

/** Best-effort reaction feedback. Host failures are intentionally invisible to the interaction. */
export function requestReactionHaptic(bridge: HostBridge, style: ReactionHapticStyle, host: unknown = typeof window === 'undefined' ? undefined : window): void {
  try {
    if (bridge.kind === 'max') {
      if (!bridge.isAvailable || !bridge.rawAuthData()?.trim()) return
      const platform = bridge.metadata()?.platform.toLowerCase()
      if (platform !== 'ios' && platform !== 'android') return
      const webApp = readRecord(host)?.WebApp
      const feedback = readRecord(webApp)?.HapticFeedback
      const impact = readRecord(feedback)?.impactOccurred
      if (typeof impact !== 'function') return
      const result = impact.call(feedback, style)
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(() => undefined)
      return
    }

    if (bridge.kind !== 'browser') return
    const vibrate = readRecord(host)?.navigator
    const method = readRecord(vibrate)?.vibrate
    if (typeof method === 'function') method.call(vibrate, 12)
  } catch {
    // Haptics are optional; a host SDK or device failure must never affect the reaction flow.
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}
