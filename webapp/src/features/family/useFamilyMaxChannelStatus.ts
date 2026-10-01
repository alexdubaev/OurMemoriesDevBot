import type { FamilyMaxChannelStatus } from '@web-app-demo/contracts'
import { useCallback, useEffect, useState } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'
import { loadFamilyMaxChannelStatus } from './api'

type ChannelState = { key: string; transport: AuthenticatedTransport; status: FamilyMaxChannelStatus | null; loading: boolean; error: boolean }

export function canManageFamilyMaxChannel(role: 'full' | 'viewer' | null, status: FamilyMaxChannelStatus | null) {
  return role === 'full' && status?.canManage === true
}

export function useFamilyMaxChannelStatus(
  transport: AuthenticatedTransport,
  familyId: string,
  currentUserId: string,
  role: 'full' | 'viewer' | null,
) {
  const key = `${familyId}\u0000${currentUserId}\u0000${role ?? 'none'}`
  const [state, setState] = useState<ChannelState>({ key: '', transport, status: null, loading: true, error: false })
  const [refreshToken, setRefreshToken] = useState(0)
  const retry = useCallback(() => setRefreshToken((value) => value + 1), [])

  useEffect(() => {
    let active = true
    let requestId = 0
    let currentController: AbortController | null = null
    const load = async () => {
      currentController?.abort()
      const controller = new AbortController()
      currentController = controller
      const thisRequest = ++requestId
      setState((previous) => previous.key === key && previous.transport === transport
        ? { ...previous, loading: true, error: false }
        : { key, transport, status: null, loading: true, error: false })
      try {
        const status = await loadFamilyMaxChannelStatus(transport, familyId, controller.signal)
        if (active && thisRequest === requestId) setState({ key, transport, status, loading: false, error: false })
      } catch {
        if (active && thisRequest === requestId) setState({ key, transport, status: null, loading: false, error: true })
      }
    }
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      active = false
      requestId += 1
      currentController?.abort()
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [familyId, key, refreshToken, transport])

  const current = state.key === key && state.transport === transport ? state : { key, transport, status: null, loading: true, error: false }
  return { ...current, retry }
}
