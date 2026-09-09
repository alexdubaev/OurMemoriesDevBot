type TelegramBotIdentityOptions = {
  token: string
  expectedUsername: string
  request?: (input: string, init?: RequestInit) => Promise<Response>
}

export async function verifyTelegramBotIdentity({
  token,
  expectedUsername,
  request = fetch,
}: TelegramBotIdentityOptions): Promise<void> {
  let response: Response
  try {
    response = await request(`https://api.telegram.org/bot${token}/getMe`, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error('Telegram getMe request failed')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Telegram getMe returned an invalid response')
  }
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
    throw new Error('Telegram getMe rejected the configured bot token')
  }
  const username = payload.result.username
  if (username !== expectedUsername) {
    throw new Error(`Configured token belongs to a different bot; expected Telegram bot @${expectedUsername}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
