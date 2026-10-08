import { toggleMediaPlayback } from '@/platform/media/playback'

export async function toggleAudioPlayback(
  element: Pick<HTMLMediaElement, 'pause' | 'paused' | 'play'>,
  isCurrentAttempt: () => boolean,
  onPlaybackChange: (playing: boolean) => void,
) {
  try {
    const playing = await toggleMediaPlayback(element)
    if (isCurrentAttempt()) onPlaybackChange(playing && !element.paused)
  } catch {
    if (isCurrentAttempt()) onPlaybackChange(false)
  }
}
