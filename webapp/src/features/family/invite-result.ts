export async function createInviteResult({
  create,
  refresh,
  toUrl,
}: {
  create: () => Promise<{ rawToken: string; expiresAt: string }>
  refresh: () => Promise<void>
  toUrl: (rawToken: string) => string | null
}) {
  const invitation = await create()
  const url = toUrl(invitation.rawToken)
  if (!url) throw new Error('Не удалось создать ссылку приглашения.')
  try {
    await refresh()
  } catch {
    // The invite is already created and the URL must remain available even if revalidation fails.
  }
  return { url, expiresAt: invitation.expiresAt }
}
