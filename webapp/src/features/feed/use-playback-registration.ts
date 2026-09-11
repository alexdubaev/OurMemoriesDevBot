import { useContext, useEffect } from 'react'
import type { RefObject } from 'react'

import { PlaybackContext } from './playback-context'

export function usePlaybackRegistration(id: string, ref: RefObject<HTMLMediaElement | null>) {
  const coordinator = useContext(PlaybackContext)
  useEffect(() => {
    const element = ref.current
    const unregister = coordinator?.register(id, () => element?.pause())
    return () => {
      element?.pause()
      unregister?.()
    }
  }, [coordinator, id, ref])
  return () => coordinator?.activate(id)
}
