import { useEffect, useMemo, useRef } from 'react'
import type { PropsWithChildren } from 'react'

import { PlaybackContext, type PlaybackCoordinator } from './playback-context'

/** One feed-scoped owner prevents two HTMLMediaElements from playing at the same time. */
export function MediaPlaybackCoordinator({ children }: PropsWithChildren) {
  const players = useRef(new Map<string, () => void>())
  const activeId = useRef<string | null>(null)
  const value = useMemo<PlaybackCoordinator>(() => ({
    activate(id) {
      players.current.forEach((pause, playerId) => { if (playerId !== id) pause() })
      activeId.current = id
    },
    pauseAll() {
      players.current.forEach((pause) => pause())
      activeId.current = null
    },
    register(id, pause) { players.current.set(id, pause); return () => { players.current.delete(id) } },
  }), [])
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) value.pauseAll() }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [value])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}
