import type { AlbumDto, AlbumEntryDto, MemoryDto } from '@web-app-demo/contracts'
import type { HttpRequestOptions } from '../../src/platform/api/http-client'
import { ApiRequestError } from '../../src/platform/api'
import { memorySources, sourceKey } from '../../src/features/albums/model'

/** Synthetic transport only for the real App harness; never imported by a production entry point. */
export function albumFixture(familyId: string, childId: string, userId: string, params: URLSearchParams) {
  const now = '2026-10-01T10:00:00.000Z'
  let sequence = 100
  const id = (number = sequence++) => `a1000000-0000-4000-8000-${String(number).padStart(12, '0')}`
  const writable = !params.has('viewer')
  const capabilities = { edit: writable, delete: writable }
  const memories = new Map<string, MemoryDto>()
  function memory(index: number, kind: 'photo' | 'note' | 'voice' = 'photo'): MemoryDto {
    const memoryId = id(index + 50_000)
    const attachment = { id: id(index + 100_000), source: 'private_storage' as const, kind: kind === 'voice' ? 'voice' as const : 'photo' as const, width: index % 3 === 0 ? 360 : 480, height: index % 3 === 0 ? 480 : 360, durationMs: kind === 'voice' ? 9000 : null, renditionStatus: 'ready' as const, previewPath: `/api/v1/families/${familyId}/media/${id(index + 100_000)}/content?variant=preview`, displayPath: `/api/v1/families/${familyId}/media/${id(index + 100_000)}/content?variant=display`, playbackPath: kind === 'voice' ? `/api/v1/families/${familyId}/media/${id(index + 100_000)}/content?variant=playback` : null, originalDownloadPath: `/api/v1/families/${familyId}/media/${id(index + 100_000)}/content?variant=original`, waveform: null }
    const result: MemoryDto = { id: memoryId, familyId, childId, author: { id: userId, name: `Автор ${index}`, avatarPath: null }, kind, body: kind === 'note' ? 'Тёплый текст из семейной заметки' : `Синтетическая работа ${index}`, occurredAt: `2026-10-${String(28 - (index % 27)).padStart(2, '0')}T10:00:00.000Z`, firstPublishedAt: now, sourcePublishedAt: null, createdAt: now, version: 1, status: 'published', attachments: kind === 'note' ? [] : [attachment], reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: true, delete: true, like: true } }
    memories.set(result.id, result); return result
  }
  const works = Math.min(2000, Math.max(24, Number(params.get('albums') || 24)))
  const photos = Array.from({ length: works }, (_, index) => memory(index))
  // One published carousel exercises individual, non-positional source selection.
  photos[0].attachments.push(photos[1].attachments[0]); memories.set(photos[0].id, photos[0])
  const note = memory(3000, 'note'); const voice = memory(3001, 'voice')
  const albums: AlbumDto[] = (['year', 'events', 'workshop', 'free'] as const).map((kind, index) => ({ id: id(index + 1), kind, templateVersion: 1, title: ['Первый год Алисы', 'Первые открытия', 'Мастерская', 'У бабушки'][index], description: null, childId: kind === 'free' ? null : childId, version: 1, cover: memorySources(photos[index])[0], entryCount: 0, createdAt: now, updatedAt: now, capabilities }))
  const entries = new Map<string, AlbumEntryDto[]>()
  function entry(index: number, fields: Partial<AlbumEntryDto> = {}): AlbumEntryDto { return { id: id(index + 10_000), kind: 'work', monthNumber: null, title: null, caption: null, childQuote: null, category: 'drawing', date: { precision: 'day', value: `2026-10-${String(28 - index % 27).padStart(2, '0')}` }, version: 1, order: index, sources: memorySources(photos[index % photos.length]).map((source) => ({ ...source, id: id() })), sourceCount: 1, aggregateVersion: 1, capabilities, ...fields } }
  entries.set(albums[0].id, Array.from({ length: 12 }, (_, index) => entry(index, { kind: 'month', monthNumber: index + 1, sources: index === 0 ? memorySources(photos[0]) : [], caption: index === 0 ? 'С каждым днём — новая маленькая история' : null, category: null, date: { precision: 'unknown', value: null } })))
  entries.set(albums[1].id, [entry(20, { kind: 'event', title: 'Первая улыбка', caption: 'Улыбнулась нам за завтраком', sources: [], date: { precision: 'month', value: '2024-03' } }), entry(21, { kind: 'event', title: 'Первое слово', caption: 'Мама', sources: [], date: { precision: 'unknown', value: null } })])
  entries.set(albums[2].id, photos.map((_, index) => entry(index, { id: id(index + 20_000), category: index % 2 ? 'craft' : 'drawing' })))
  entries.set(albums[3].id, [entry(30, { title: 'В саду', caption: 'Тёплый день у бабушки', sources: [...memorySources(photos[0]).slice(0, 1), ...memorySources(photos[2]), ...memorySources(voice), ...memorySources(note)] }), entry(31, { title: 'Печём пирог' })])
  albums.forEach((album) => { album.entryCount = album.kind === 'year' ? 1 : entries.get(album.id)!.length })
  const log: { path: string; method: string; key?: string; body?: unknown }[] = []
  const replay = new Map<string, unknown>()
  let failAttach = params.has('attachFail')
  let revokeNextAlbumRead = false
  let delayNextEntriesPage = false
  let failNextPickerRead = false
  Object.assign(window, {
    __albumsEvidence: { log, albums, entries, published: 0, rawPaths: [] as string[], lateReadStarted: false, lateReadCompleted: false },
    __albumsDelay: false,
    __albumsRevokeOnNextRead: () => { revokeNextAlbumRead = true; delayNextEntriesPage = true; evidence.lateReadStarted = false; evidence.lateReadCompleted = false },
    __albumsFailNextPickerRead: () => { failNextPickerRead = true },
  })
  const evidence = (window as unknown as { __albumsEvidence: { published: number; rawPaths: string[]; lateReadStarted: boolean; lateReadCompleted: boolean } }).__albumsEvidence
  const bump = (album: AlbumDto, item: AlbumEntryDto) => { album.version += 1; item.version += 1; item.aggregateVersion = album.version; album.entryCount = album.kind === 'year' ? (entries.get(album.id) ?? []).filter((item) => item.caption || item.sources.some((source) => source.available)).length : entries.get(album.id)!.length }
  async function request(path: string, options: HttpRequestOptions = {}): Promise<{ handled: boolean; value?: unknown }> {
    const method = options.method ?? 'GET'
    const parsed = new URL(path, location.origin)
    const familyPrefix = `/api/v1/families/${familyId}`
    if (!path.startsWith(familyPrefix)) return { handled: false }
    const route = parsed.pathname.slice(familyPrefix.length)
    if (!route.startsWith('/albums') && !route.startsWith('/media-picker') && !(route.startsWith('/memories/') || route === '/memories' && method === 'POST')) return { handled: false }
    const headers = new Headers(options.headers)
    const key = headers.get('Idempotency-Key') ?? undefined
    const body = options.body as Record<string, unknown> | undefined
    log.push({ path, method, key, body })
    if (key && replay.has(`${route}:${key}`)) return { handled: true, value: replay.get(`${route}:${key}`) }
    const done = (value: unknown) => { if (key) replay.set(`${route}:${key}`, structuredClone(value)); return { handled: true, value } }
    if (route === '/memories' && method === 'POST') {
      if (params.has('delayedPublish')) await new Promise((resolve) => setTimeout(resolve, 600))
      const saved = memory(sequence++, 'note'); saved.body = String(body?.body ?? ''); evidence.published += 1
      return done(saved)
    }
    if (route.startsWith('/memories/')) return done(memories.get(route.split('/')[2]))
    if (route === '/media-picker') {
      if (method === 'GET' && failNextPickerRead) { failNextPickerRead = false; throw new ApiRequestError(404, 'NOT_FOUND', 'Synthetic source no longer exists') }
      const kind = parsed.searchParams.get('kind')
      const catalog = [...photos.slice(0, 25), note, voice].filter((memory) => !kind || memory.kind === kind)
      const start = Number(parsed.searchParams.get('cursor') ?? 0)
      return done({ items: catalog.slice(start, start + 20).map((memory) => ({ memoryId: memory.id, kind: memory.kind, occurredAt: memory.occurredAt, sources: memorySources(memory) })), nextCursor: start + 20 < catalog.length ? String(start + 20) : null })
    }
    if (route === '/albums') {
      if (method === 'POST') {
        const album: AlbumDto = { ...albums[0], id: id(), kind: body!.kind as AlbumDto['kind'], childId: body!.childId as string | null, title: String(body!.title), description: body!.description as string | null, cover: null, entryCount: 0, version: 1 }
        albums.push(album); entries.set(album.id, album.kind === 'year' ? Array.from({ length: 12 }, (_, index) => entry(sequence++, { monthNumber: index + 1, kind: 'month', sources: [], caption: null })) : [])
        return done({ album, replayed: false })
      }
      const filter = parsed.searchParams.get('filter')
      return done({ items: albums.filter((album) => filter === 'template' ? album.kind !== 'free' : filter === 'custom' ? album.kind === 'free' : true), nextCursor: null })
    }
    const segments = route.split('/').filter(Boolean)
    const album = albums.find((album) => album.id === segments[1])
    if (!album) throw new ApiRequestError(404, 'NOT_FOUND', 'Synthetic album missing')
    if (segments.length === 2) {
      if (method === 'GET' && revokeNextAlbumRead) { revokeNextAlbumRead = false; throw new ApiRequestError(404, 'ALBUM_SCOPE_UNAVAILABLE', 'Synthetic family membership revoked') }
      if (method === 'GET' && params.has('delayedAlbum') && album.kind === 'year') await new Promise((resolve) => setTimeout(resolve, 900))
      if (method === 'DELETE') { albums.splice(albums.indexOf(album), 1); return done(null) }
      if (method === 'PATCH') { Object.assign(album, body); album.version += 1 }
      return done({ album })
    }
    const list = entries.get(album.id)!
    if (segments[2] === 'workshop-groups') return done({ groups: [{ year: 2026, month: 10, count: list.length }] })
    if (segments[2] === 'entries:reorder') { const index = list.findIndex((item) => item.id === body!.entryId); const [item] = list.splice(index, 1); const before = body!.beforeEntryId ? list.findIndex((item) => item.id === body!.beforeEntryId) : list.length; list.splice(before, 0, item); bump(album, item); return done({ album }) }
    if (segments.length === 3 && method === 'GET') {
      if (delayNextEntriesPage) { delayNextEntriesPage = false; evidence.lateReadStarted = true; await new Promise((resolve) => setTimeout(resolve, 900)); evidence.lateReadCompleted = true }
      const filtered = list.filter((entry) => !parsed.searchParams.get('category') || entry.category === parsed.searchParams.get('category'))
      const start = Number(parsed.searchParams.get('cursor') ?? 0)
      return done({ items: filtered.slice(start, start + 48).map((item) => ({ ...item, aggregateVersion: album.version })), nextCursor: start + 48 < filtered.length ? String(start + 48) : null })
    }
    if (method === 'POST' && segments.length === 3) {
      if (failAttach) { failAttach = false; throw new TypeError('Synthetic lost attach response before commit') }
      const sources = (body!.sources as { memoryId: string; sourceKind: string; sourceId: string }[]).map((ref) => ({ ...memorySources(memories.get(ref.memoryId)!).find((source) => sourceKey(source) === sourceKey(ref as never))!, id: id() }))
      const input = { ...body }; delete input.expectedVersion
      const saved = entry(sequence++, { ...input, id: id(), sources, sourceCount: sources.length } as Partial<AlbumEntryDto>); list.push(saved); bump(album, saved)
      return done({ entry: saved, replayed: false })
    }
    const item = list.find((entry) => entry.id === segments[3])!
    if (method === 'GET') return done({ entry: { ...item, aggregateVersion: album.version } })
    if (method === 'DELETE') { list.splice(list.indexOf(item), 1); bump(album, item); return done(null) }
    if (segments[4] === 'sources') { item.sources = (body!.sources as { memoryId: string; sourceKind: string; sourceId: string }[]).map((ref) => ({ ...memorySources(memories.get(ref.memoryId)!).find((source) => sourceKey(source) === sourceKey(ref as never))!, id: id() })); item.sourceCount = item.sources.length }
    else if (segments[4] === 'clear') { item.sources = []; item.caption = null; item.sourceCount = 0 }
    else { const input = { ...body }; delete input.expectedVersion; Object.assign(item, input) }
    bump(album, item); return done({ entry: item })
  }
  async function raw(path: string) {
    if (!path.includes('/media/a1000000-')) return null
    evidence.rawPaths.push(path)
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160
    const ctx = canvas.getContext('2d')!
    const number = Number(/(\d{12})\/content/.exec(path)?.[1] ?? 0)
    ctx.fillStyle = ['#f4ead5', '#e1e9e1', '#f0e1df', '#dde6eb'][number % 4]; ctx.fillRect(0, 0, 160, 160)
    ctx.fillStyle = ['#d69b74', '#668c70', '#d6ba5c', '#b395b2'][number % 4]; ctx.beginPath(); ctx.arc(80, 80, 43, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#f7f4e9'; ctx.fillRect(42, 69, 76, 23)
    return new Response(await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png')), { headers: { 'Content-Type': 'image/png' } })
  }
  return { request, raw }
}
