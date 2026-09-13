const botUrl = 'https://t.me/OurMemoriesDevBot'

export function createInviteLink(rawToken: string) {
  return `${botUrl}?startapp=invite_${encodeURIComponent(rawToken)}`
}
