import { Hono, type Context } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  albumParamsSchema,
  albumEntryParamsSchema,
  clearAlbumEntryRequestSchema,
  createAlbumRequestSchema,
  ifMatchVersionHeadersSchema,
  idempotencyKeyHeadersSchema,
  listAlbumsQuerySchema,
  listAlbumEntriesQuerySchema,
  mediaPickerQuerySchema,
  reorderAlbumEntryRequestSchema,
  updateAlbumEntryRequestSchema,
  updateAlbumRequestSchema,
  albumEntryCommentParamsSchema,
  albumEntryDiscussionGenerationQuerySchema,
  createAlbumEntryCommentRequestSchema,
  updateAlbumEntryCommentRequestSchema,
  listAlbumEntryCommentsQuerySchema,
  setAlbumEntryReactionRequestSchema,
} from '@web-app-demo/contracts'
import type { AuthHttpEnv } from '../../auth'
import type { AlbumService } from '../application/album-service'
import type { AlbumSocialService } from '../application/album-social-service'
import { AlbumFailure } from '../domain/errors'
import { MemoryFailure } from '../../memories'
import { errorResponse, requestIdFrom, validationErrorResponse } from '../../../http/errors'

const familyParams = z.object({ familyId: z.uuid().toLowerCase() }).strict()
const entryParams = albumEntryParamsSchema
const versionBody = z.object({ expectedVersion: z.number().int().positive() }).strict()
const monthSourcesQuery = z.object({ cursor: z.string().min(1).max(2048).optional(), limit: z.coerce.number().int().min(2).max(24).default(24) }).strict()
const scope = (user: AuthHttpEnv['Variables']['user'], familyId: string) => ({ familyId, principal: { userId: user.id, sessionId: user.sessionId } })

export function createAlbumRoutes({ requireAuth, service, social }: { requireAuth: MiddlewareHandler<AuthHttpEnv>; service: AlbumService; social: AlbumSocialService }) {
  const routes = new Hono<AuthHttpEnv>()
  routes.use('/families/:familyId/albums/*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next() })
  routes.use('/families/:familyId/albums', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next() })
  routes.use('/families/:familyId/media-picker', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next() })
  routes.use('/families/:familyId/albums/*', requireAuth)
  routes.use('/families/:familyId/albums', requireAuth)
  routes.use('/families/:familyId/media-picker', requireAuth)
  const discussionPath = '/families/:familyId/albums/:albumId/entries/:entryId'
  const discussionBodyLimit = bodyLimit({ maxSize: 16_384, onError: (c) => c.json(errorResponse('BAD_REQUEST', 'Слишком большой запрос', requestIdFrom(c)), 413) })
  routes.use(`${discussionPath}/comments`, discussionBodyLimit)
  routes.use(`${discussionPath}/comments/*`, discussionBodyLimit)
  routes.use(`${discussionPath}/reaction`, discussionBodyLimit)

  routes.get('/families/:familyId/albums', (c) => run(c, async () => {
    const p = familyParams.parse(c.req.param())
    const query = listAlbumsQuerySchema.parse(c.req.query())
    return c.json(await service.list(scope(c.var.user, p.familyId), query))
  }))
  routes.post('/families/:familyId/albums', (c) => run(c, async () => {
    const p = familyParams.parse(c.req.param())
    const key = idempotencyKeyHeadersSchema.parse({ 'idempotency-key': c.req.header('idempotency-key') })['idempotency-key']
    const input = createAlbumRequestSchema.parse(await c.req.json())
    const result = await service.create(scope(c.var.user, p.familyId), input, key)
    return c.json(result, result.replayed ? 200 : 201)
  }))
  routes.get('/families/:familyId/media-picker', (c) => run(c, async () => {
    const p = familyParams.parse(c.req.param())
    return c.json(await service.picker(scope(c.var.user, p.familyId), mediaPickerQuerySchema.parse(c.req.query())))
  }))
  routes.get('/families/:familyId/albums/:albumId', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    return c.json({ album: await service.get(scope(c.var.user, p.familyId), p.albumId) })
  }))
  routes.patch('/families/:familyId/albums/:albumId', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    const input = updateAlbumRequestSchema.parse(await c.req.json())
    const result = await service.update(scope(c.var.user, p.familyId), p.albumId, input)
    return c.json({ album: result })
  }))
  routes.delete('/families/:familyId/albums/:albumId', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    const input = ifMatchVersionHeadersSchema.parse({ 'if-match': c.req.header('if-match') })
    await service.remove(scope(c.var.user, p.familyId), p.albumId, input['if-match'])
    return c.body(null, 204)
  }))
  routes.get('/families/:familyId/albums/:albumId/entries', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    return c.json(await service.entries(scope(c.var.user, p.familyId), p.albumId, listAlbumEntriesQuerySchema.parse(c.req.query())))
  }))
  routes.post('/families/:familyId/albums/:albumId/entries', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    const key = idempotencyKeyHeadersSchema.parse({ 'idempotency-key': c.req.header('idempotency-key') })['idempotency-key']
    const result = await service.createEntry(scope(c.var.user, p.familyId), p.albumId, await c.req.json(), key)
    return c.json(result, result.replayed ? 200 : 201)
  }))
  routes.get('/families/:familyId/albums/:albumId/workshop-groups', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    return c.json(await service.groups(scope(c.var.user, p.familyId), p.albumId))
  }))
  routes.post('/families/:familyId/albums/:albumId/entries:reorder', (c) => run(c, async () => {
    const p = albumParamsSchema.parse(c.req.param())
    const input = reorderAlbumEntryRequestSchema.parse(await c.req.json())
    return c.json({ album: await service.reorder(scope(c.var.user, p.familyId), p.albumId, input.expectedVersion, input.entryId, input.beforeEntryId) })
  }))
  routes.get('/families/:familyId/albums/:albumId/entries/:entryId', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    return c.json({ entry: await service.getEntry(scope(c.var.user, p.familyId), p.albumId, p.entryId) })
  }))
  routes.get('/families/:familyId/albums/:albumId/entries/:entryId/month-sources', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    return c.json(await service.monthSources(scope(c.var.user, p.familyId), p.albumId, p.entryId, monthSourcesQuery.parse(c.req.query())))
  }))
  routes.patch('/families/:familyId/albums/:albumId/entries/:entryId', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    const input = updateAlbumEntryRequestSchema.parse(await c.req.json())
    return c.json({ entry: await service.updateEntry(scope(c.var.user, p.familyId), p.albumId, p.entryId, input) })
  }))
  routes.put('/families/:familyId/albums/:albumId/entries/:entryId/sources', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    const key = idempotencyKeyHeadersSchema.parse({ 'idempotency-key': c.req.header('idempotency-key') })['idempotency-key']
    return c.json({ entry: await service.setSources(scope(c.var.user, p.familyId), p.albumId, p.entryId, await c.req.json(), key) })
  }))
  routes.post('/families/:familyId/albums/:albumId/entries/:entryId/clear', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    const input = clearAlbumEntryRequestSchema.parse(await c.req.json())
    return c.json({ entry: await service.clearEntry(scope(c.var.user, p.familyId), p.albumId, p.entryId, input.expectedVersion) })
  }))
  routes.delete('/families/:familyId/albums/:albumId/entries/:entryId', (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    const input = ifMatchVersionHeadersSchema.parse({ 'if-match': c.req.header('if-match') })
    await service.deleteEntry(scope(c.var.user, p.familyId), p.albumId, p.entryId, input['if-match'])
    return c.body(null, 204)
  }))
  routes.get(`${discussionPath}/discussion`, (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    return c.json(await social.discussion(scope(c.var.user, p.familyId), p.albumId, p.entryId))
  }))
  routes.get(`${discussionPath}/comments`, (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    return c.json(await social.list(scope(c.var.user, p.familyId), p.albumId, p.entryId, listAlbumEntryCommentsQuerySchema.parse(c.req.query())))
  }))
  routes.post(`${discussionPath}/comments`, (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    const key = idempotencyKeyHeadersSchema.parse({ 'idempotency-key': c.req.header('idempotency-key') })['idempotency-key']
    const result = await social.create(scope(c.var.user, p.familyId), p.albumId, p.entryId, createAlbumEntryCommentRequestSchema.parse(await socialBody(c)), key)
    return c.json({ comment: result.comment, summary: result.summary }, result.replayed ? 200 : 201)
  }))
  routes.patch(`${discussionPath}/comments/:commentId`, (c) => run(c, async () => {
    const p = albumEntryCommentParamsSchema.parse(c.req.param())
    const input = updateAlbumEntryCommentRequestSchema.parse(await socialBody(c))
    return c.json(await social.update(scope(c.var.user, p.familyId), { ...p, discussionGeneration: input.discussionGeneration }, p.commentId, input))
  }))
  routes.delete(`${discussionPath}/comments/:commentId`, (c) => run(c, async () => {
    const p = albumEntryCommentParamsSchema.parse(c.req.param())
    const query = albumEntryDiscussionGenerationQuerySchema.parse(c.req.query())
    const headers = ifMatchVersionHeadersSchema.parse({ 'if-match': c.req.header('if-match') })
    return c.json(await social.delete(scope(c.var.user, p.familyId), { ...p, ...query }, p.commentId, headers['if-match']))
  }))
  routes.put(`${discussionPath}/reaction`, (c) => run(c, async () => {
    const p = entryParams.parse(c.req.param())
    return c.json(await social.setReaction(scope(c.var.user, p.familyId), p.albumId, p.entryId, setAlbumEntryReactionRequestSchema.parse(await socialBody(c))))
  }))
  return routes
}

async function socialBody(c: Context<AuthHttpEnv>): Promise<unknown> {
  try { return await c.req.json() }
  catch { throw new AlbumFailure('invalid_input', 'Некорректный JSON запроса') }
}

async function run(c: Context<AuthHttpEnv>, operation: () => Promise<Response>) {
  try { return await operation() }
  catch (error) {
    if (error instanceof z.ZodError) return c.json(validationErrorResponse(error.issues, requestIdFrom(c)), 422)
    if (error instanceof MemoryFailure) {
      const status = error.kind === 'media_unavailable' || error.kind === 'not_found' ? 404 : error.kind === 'forbidden' ? 403 : error.kind === 'invalid_input' ? 422 : 409
      const code = error.kind === 'media_unavailable' || error.kind === 'not_found' ? 'NOT_FOUND' : error.kind === 'forbidden' ? 'ROLE_FORBIDDEN' : error.kind === 'invalid_input' ? 'INVALID_INPUT' : error.kind === 'version_conflict' ? 'VERSION_CONFLICT' : error.kind === 'idempotency_conflict' ? 'IDEMPOTENCY_CONFLICT' : 'CONFLICT'
      return c.json({ error: { code, message: error.message, requestId: requestIdFrom(c) } }, status)
    }
    if (error instanceof AlbumFailure) {
      const status = error.kind === 'not_found' || error.kind === 'scope_unavailable' ? 404 : error.kind === 'forbidden' ? 403 : error.kind === 'invalid_input' ? 422 : 409
      const code = error.kind === 'scope_unavailable' ? 'ALBUM_SCOPE_UNAVAILABLE' : error.kind === 'not_found' ? 'NOT_FOUND' : error.kind === 'forbidden' ? 'ROLE_FORBIDDEN' : error.kind === 'invalid_input' ? 'INVALID_INPUT' : error.kind === 'version_conflict' ? 'VERSION_CONFLICT' : error.kind === 'idempotency_conflict' ? 'IDEMPOTENCY_CONFLICT' : 'CONFLICT'
      return c.json({ error: { code, message: error.message, requestId: requestIdFrom(c) } }, status)
    }
    throw error
  }
}
