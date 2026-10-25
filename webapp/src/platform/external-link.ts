/**
 * Links that leave the app (shop pages from the gift list). Only plain http(s) links
 * without embedded credentials are allowed; everything else must never reach the host.
 */
export function isSafeExternalLink(url: string): boolean {
  if (typeof url !== 'string') return false
  try {
    const target = new URL(url)
    return (target.protocol === 'http:' || target.protocol === 'https:') &&
      !target.username && !target.password
  } catch {
    return false
  }
}
