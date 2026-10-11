import type { MaxVideoRendition } from '../application/ports'

const allowedCdnHost = /^maxvd[0-9]+\.okcdn\.ru$/i
const preferredHeight = 720

export function isAllowedMaxVideoUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && allowedCdnHost.test(url.hostname)
  } catch { return false }
}

export function selectMaxVideoRendition(renditions: MaxVideoRendition[], maxBytes?: number) {
  const candidates = renditions.filter((item) => isAllowedMaxVideoUrl(item.url) &&
    (maxBytes === undefined || item.contentLength === null || item.contentLength <= maxBytes))
  const withinPreference = candidates.filter((item) => item.height !== null && item.height > 0 && item.height <= preferredHeight)
  const higher = candidates.filter((item) => item.height !== null && item.height > preferredHeight)
  const unknown = candidates.filter((item) => item.height === null)
  const pool = withinPreference.length ? withinPreference : higher.length ? higher : unknown
  return [...pool].sort((a, b) => {
    if (a.height !== null && b.height !== null && a.height !== b.height) {
      return withinPreference.length ? b.height - a.height : a.height - b.height
    }
    if (a.contentLength !== b.contentLength) {
      if (a.contentLength === null) return 1
      if (b.contentLength === null) return -1
      return a.contentLength - b.contentLength
    }
    const width = (b.width ?? 0) - (a.width ?? 0)
    if (width !== 0) return width
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
  })[0] ?? null
}
