import { useContext, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { PlaybackContext } from './playback-context'

export function usePlaybackRegistration(id: string, ref: RefObject<HTMLMediaElement | null>) {
  const coordinator = useContext(PlaybackContext)
  const instanceToken = useRef<symbol | null>(null)
  instanceToken.current ??= Symbol(id)
  useEffect(() => {
    const element = ref.current
    const token = instanceToken.current!
    const unregister = coordinator?.register(token, () => element?.pause())
    return () => {
      element?.pause()
      unregister?.()
    }
  }, [coordinator, ref])
  return () => coordinator?.activate(instanceToken.current!)
}
