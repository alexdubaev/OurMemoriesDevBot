/** Build the MAX bot-start URL from an opaque family invite token. */
export function createMaxInviteLink(rawToken: string, username: string | undefined): string | null {
  if (!/^[A-Za-z0-9_-]{32,121}$/.test(rawToken)) return null
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null

  const payload = `invite_${rawToken}`
  if (payload.length > 128) return null
  return `https://max.ru/${username}?start=${encodeURIComponent(payload)}`
}
