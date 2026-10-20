import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import type { AuthHttpEnv } from '../../auth'
import type { FamilyScope } from '../../families'

export type MaxChannelAvatarContent = { bytes: Uint8Array; contentType: string | null; contentLength: number }

const avatarHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
}

export function createMaxChannelAvatarRoutes(options: {
  requireAuth: MiddlewareHandler<AuthHttpEnv>
  read: (scope: FamilyScope, chatId: bigint, signal?: AbortSignal) => Promise<MaxChannelAvatarContent | null>
}) {
  const routes = new Hono<AuthHttpEnv>()
  routes.use('/families/*', options.requireAuth)
  routes.get('/families/:familyId/media/max-channels/:chatId/avatar', async (c) => {
    const familyId = c.req.param('familyId')
    const rawChatId = c.req.param('chatId')
    if (!isUuid(familyId) || !/^-?[0-9]{1,19}$/.test(rawChatId)) return unavailable(c)
    let chatId: bigint
    try {
      chatId = BigInt(rawChatId)
      if (chatId < -(1n << 63n) || chatId > (1n << 63n) - 1n) return unavailable(c)
    } catch { return unavailable(c) }
    let result
    try {
      result = await options.read({ familyId, principal: { userId: c.var.user.id, sessionId: c.var.user.sessionId } }, chatId, c.req.raw.signal)
    } catch { return unavailable(c) }
    if (!result) return unavailable(c)
    return new Response(Uint8Array.from(result.bytes).buffer as ArrayBuffer, { status: 200, headers: {
      ...avatarHeaders,
      'Content-Type': result.contentType ?? 'application/octet-stream',
      'Content-Length': String(result.contentLength),
    } })
  })
  return routes
}

function unavailable(context: { body: (body: null, status: 404, headers: Record<string, string>) => Response }) {
  return context.body(null, 404, avatarHeaders)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
