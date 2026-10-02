export function loadMaxVideoSourceOnce(video: Pick<HTMLMediaElement, 'src' | 'load' | 'removeAttribute'>, src: string | null, loadedSource: string | null) {
  if (loadedSource === src) return loadedSource
  if (src === null) {
    video.removeAttribute('src')
    video.load()
    return null
  }
  video.src = src
  return src
}
