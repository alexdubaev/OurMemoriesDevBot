import { useEffect, useMemo, useRef } from 'react'
import type { PropsWithChildren } from 'react'

import { PlaybackContext, type PlaybackCoordinator } from './playback-context'

/** One feed-scoped owner prevents two HTMLMediaElements from playing at the same time. */
export function MediaPlaybackCoordinator({ active = true, children }: PropsWithChildren<{ active?: boolean }>) {
  const owner = useRef<{ token: symbol; stop: () => void } | null>(null)
  const value = useMemo<PlaybackCoordinator>(() => ({
    activate(token, stop) {
      const previous = owner.current
      if (previous?.token === token) return
      owner.current = null
      previous?.stop()
      owner.current = { token, stop }
    },
    pauseAll() {
      const previous = owner.current
      owner.current = null
      previous?.stop()
    },
    release(token) {
      if (owner.current?.token !== token) return
      const previous = owner.current
      owner.current = null
      previous.stop()
    },
    clear(token) { if (owner.current?.token === token) owner.current = null },
  }), [])
  useEffect(() => {
    if (!active) value.pauseAll()
  }, [active, value])
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) value.pauseAll() }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [value])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}
