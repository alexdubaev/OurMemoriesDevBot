import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { TelegramInboundEvent } from './update-mapping'
import { normalizeTelegramUpdate } from './update-mapping'

export function createTelegramWebhook(options: {
  secret: string
  bodyLimitBytes: number
  acceptUpdate: (event: TelegramInboundEvent) => Promise<unknown>
}) {
  const routes = new Hono()
  routes.use('/webhooks/telegram', bodyLimit({
    maxSize: options.bodyLimitBytes,
    onError: (c) => c.json({ ok: false }, 413),
  }))
  routes.post('/webhooks/telegram', async (c) => {
    if (!sameSecret(c.req.header('X-Telegram-Bot-Api-Secret-Token'), options.secret)) {
      return c.json({ ok: false }, 401)
    }
    const declaredLength = Number(c.req.header('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > options.bodyLimitBytes) {
      return c.json({ ok: false }, 413)
    }
    const body = await c.req.text()
    if (Buffer.byteLength(body, 'utf8') > options.bodyLimitBytes) return c.json({ ok: false }, 413)
    let event: TelegramInboundEvent
    try { event = normalizeTelegramUpdate(JSON.parse(body)) }
    catch { return c.json({ ok: false }, 400) }
    try {
      await options.acceptUpdate(event)
      return c.json({ ok: true }, 200)
    } catch {
      return c.json({ ok: false }, 503)
    }
  })
  return routes
}

function sameSecret(received: string | undefined, expected: string) {
  if (!received) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
