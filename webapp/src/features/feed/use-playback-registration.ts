import { useContext, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { PlaybackContext } from './playback-context'

export function usePlaybackRegistration(id: string, ref: RefObject<HTMLMediaElement | null>, onStop?: () => void) {
  const coordinator = useContext(PlaybackContext)
  const instanceToken = useRef<symbol | null>(null)
  instanceToken.current ??= Symbol(id)
  useEffect(() => () => coordinator?.release(instanceToken.current!), [coordinator])
  return {
    activate: () => {
      const element = ref.current
      coordinator?.activate(instanceToken.current!, () => {
        element?.pause()
        onStop?.()
      })
    },
    clear: () => coordinator?.clear(instanceToken.current!),
  }
}
