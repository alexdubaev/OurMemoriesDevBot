import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import type { PropsWithChildren, RefObject } from 'react'

type Coordinator = { activate(id: string): void; register(id: string, pause: () => void): () => void }
const PlaybackContext = createContext<Coordinator | null>(null)

/** One feed-scoped owner prevents two HTMLMediaElements from playing at the same time. */
export function MediaPlaybackCoordinator({ children }: PropsWithChildren) {
  const players = useRef(new Map<string, () => void>())
  const value = useMemo<Coordinator>(() => ({
    activate(id) { players.current.forEach((pause, playerId) => { if (playerId !== id) pause() }) },
    register(id, pause) { players.current.set(id, pause); return () => { players.current.delete(id) } },
  }), [])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

export function usePlaybackRegistration(id: string, ref: RefObject<HTMLMediaElement | null>) {
  const coordinator = useContext(PlaybackContext)
  useEffect(() => coordinator?.register(id, () => ref.current?.pause()), [coordinator, id, ref])
  return () => coordinator?.activate(id)
}
