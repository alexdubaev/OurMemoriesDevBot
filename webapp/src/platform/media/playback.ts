export async function toggleMediaPlayback(element: Pick<HTMLMediaElement, 'pause' | 'paused' | 'play'>) {
  if (element.paused) {
    await element.play()
    return true
  }
  element.pause()
  return false
}
