import { useEffect, useMemo, useRef } from 'react'
import type { PropsWithChildren } from 'react'

import { PlaybackContext, type PlaybackCoordinator } from './playback-context'

/** One feed-scoped owner prevents two HTMLMediaElements from playing at the same time. */
export function MediaPlaybackCoordinator({ children }: PropsWithChildren) {
  const players = useRef(new Map<symbol, () => void>())
  const activeToken = useRef<symbol | null>(null)
  const value = useMemo<PlaybackCoordinator>(() => ({
    activate(token) {
      players.current.forEach((pause, playerToken) => { if (playerToken !== token) pause() })
      activeToken.current = token
    },
    pauseAll() {
      players.current.forEach((pause) => pause())
      activeToken.current = null
    },
    register(token, pause) { players.current.set(token, pause); return () => { players.current.delete(token) } },
  }), [])
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) value.pauseAll() }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [value])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}
