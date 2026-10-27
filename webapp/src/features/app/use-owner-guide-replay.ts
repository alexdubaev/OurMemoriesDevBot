import { controlMeSchema } from '@web-app-demo/contracts'
import { useEffect, useState } from 'react'
import type { AuthenticatedTransport } from '@/platform/api'

export function useOwnerGuideReplay(transport: AuthenticatedTransport, enabled: boolean) {
  const [state, setState] = useState<{ transport: AuthenticatedTransport; eligible: boolean; request: number } | null>(null)
  const eligible = enabled && state?.transport === transport && state.eligible
  const request = state?.transport === transport ? state.request : 0

  useEffect(() => {
    if (!enabled) return
    let active = true
    const controller = new AbortController()
    void transport.request('/api/v1/control/me', controlMeSchema, { signal: controller.signal })
      .then(() => { if (active) setState((previous) => ({ transport, eligible: true, request: (previous?.request ?? 0) + 1 })) })
      .catch(() => { if (active) setState((previous) => ({ transport, eligible: false, request: previous?.request ?? 0 })) })
    return () => { active = false; controller.abort() }
  }, [enabled, transport])

  useEffect(() => {
    if (!eligible) return
    let wasHidden = document.visibilityState === 'hidden'
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden'
      if (wasHidden && !hidden) setState((previous) => previous?.transport === transport && previous.eligible
        ? { ...previous, request: previous.request + 1 } : previous)
      wasHidden = hidden
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [eligible, transport])

  return { eligible, request }
}
