import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'

import { useAuth } from './use-auth'
import {
  activatePrivateCacheIdentity,
  clearPrivateUserCache,
  persistPrivateQueryCache,
  privateCacheIdentityGeneration,
  restorePrivateQueryCache,
} from '@/platform/persistence/private-cache'

export function PrivateCacheGate({ children, fallback }: PropsWithChildren<{ fallback: ReactNode }>) {
  const auth = useAuth()
  const queryClient = useQueryClient()
  const userId = auth.user?.id ?? null
  const lastIdentity = useRef<string | null>(null)
  const [hydrated, setHydrated] = useState<{ userId: string; generation: number } | null>(null)

  useEffect(() => {
    const previous = lastIdentity.current
    const generation = activatePrivateCacheIdentity(userId)
    lastIdentity.current = userId
    if (previous && previous !== userId) void clearPrivateUserCache(previous)
    if (!userId) {
      return
    }

    let cancelled = false
    let cacheAbandoned = false
    let timer: number | undefined
    let unsubscribe: (() => void) | undefined
    const hydrate = restorePrivateQueryCache(queryClient, userId, generation, () => !cancelled && !cacheAbandoned)
      .catch(() => false)
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = window.setTimeout(() => resolve('timeout'), 5000)
    })
    void Promise.race([hydrate, deadline])
      .then((result) => {
        if (cancelled) return
        if (timer !== undefined) window.clearTimeout(timer)
        if (result === 'timeout') cacheAbandoned = true
        unsubscribe = queryClient.getQueryCache().subscribe(() => {
          if (timer !== undefined) window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            timer = undefined
            void persistPrivateQueryCache(queryClient, userId, generation).catch(() => undefined)
          }, 120)
        })
        setHydrated({ userId, generation })
      })

    return () => {
      cancelled = true
      unsubscribe?.()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [queryClient, userId])

  if (auth.isBootstrapping || (userId && (hydrated?.userId !== userId || hydrated.generation !== privateCacheIdentityGeneration()))) return fallback
  return children
}
