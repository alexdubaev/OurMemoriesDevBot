import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import type { MaxAcceptedEvent } from '../application/ports'
import { normalizeMaxUpdate } from './update-mapping'

export function createMaxWebhook(options: {
  secret: string
  bodyLimitBytes: number
  acceptUpdate: (event: MaxAcceptedEvent) => Promise<unknown>
}) {
  const routes = new Hono()
  routes.use('/webhooks/max', async (c, next) => {
    if (!sameSecret(c.req.header('X-Max-Bot-Api-Secret'), options.secret)) return c.json({ ok: false }, 401)
    await next()
  })
  routes.use('/webhooks/max', bodyLimit({
    maxSize: options.bodyLimitBytes,
    onError: (c) => c.json({ ok: false }, 413),
  }))
  routes.post('/webhooks/max', async (c) => {
    const declaredLength = Number(c.req.header('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > options.bodyLimitBytes) return c.json({ ok: false }, 413)
    const body = await c.req.text()
    if (Buffer.byteLength(body, 'utf8') > options.bodyLimitBytes) return c.json({ ok: false }, 413)
    let update: unknown
    try { update = JSON.parse(body) } catch { return c.json({ ok: false }, 400) }
    let event: ReturnType<typeof normalizeMaxUpdate>
    try { event = normalizeMaxUpdate(update, body) } catch { return c.json({ ok: false }, 400) }
    if (event.kind === 'ignored') return c.json({ ok: true }, 200)
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
