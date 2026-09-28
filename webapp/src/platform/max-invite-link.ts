/** Build the MAX Mini App launch URL from an opaque family invite token. */
export function createMaxInviteLink(rawToken: string, username: string | undefined): string | null {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(rawToken)) return null
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null

  const payload = `invite_${rawToken}`
  if (payload.length > 512) return null
  return `https://max.ru/${username}?startapp=${encodeURIComponent(payload)}`
}
