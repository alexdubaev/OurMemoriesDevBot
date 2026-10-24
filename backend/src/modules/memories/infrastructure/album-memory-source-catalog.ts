import {
  maxVideoAttachmentSchema,
  mediaDtoSchema,
  telegramVideoAttachmentSchema,
  type MemoryAttachment,
} from '@web-app-demo/contracts'
import { Prisma } from '../../../generated/prisma/client'
import type { PrismaTransactionClient } from '../../../idempotency'
import type { FamilyScope } from '../../families'
import { MemoryFailure } from '../domain/errors'
import type {
  AlbumMemorySourceCatalog,
  AlbumMemorySourceProjection,
  AlbumMemorySourceRef,
  AlbumSourceCursor,
  AlbumSourceFilter,
} from '../application/album-source-ports'

const sourceInclude = {
  media: { orderBy: { position: 'asc' as const }, include: { asset: { include: { variants: { select: { variant: true } } } } } },
  maxVideoReferences: { orderBy: { attachmentPosition: 'asc' as const }, include: { thumbnailMedia: { include: { variants: { select: { variant: true } } } } } },
  telegramVideoReference: { include: { thumbnailMedia: { include: { variants: { select: { variant: true } } } } } },
} as const

export function createAlbumMemorySourceCatalog(): AlbumMemorySourceCatalog {
  return {
    async resolve(tx, scope, refs, lock) {
      const uniqueMemoryIds = [...new Set(refs.map((ref) => ref.memoryId))].sort()
      if (!uniqueMemoryIds.length) return []
      await lockMemories(tx, scope.familyId, uniqueMemoryIds, lock)
      const memories = await tx.memory.findMany({
        where: { id: { in: uniqueMemoryIds }, familyId: scope.familyId, status: 'published', deletedAt: null },
        include: sourceInclude,
      })
      if (memories.length !== uniqueMemoryIds.length) throw unavailable()
      const byId = new Map(memories.map((memory) => [memory.id, memory]))
      const result: AlbumMemorySourceProjection[] = []
      for (const ref of refs) {
        const memory = byId.get(ref.memoryId)
        if (!memory) throw unavailable()
        const projected = projectOne(memory, scope.familyId, ref)
        if (!projected?.available) throw unavailable()
        result.push(projected)
      }
      return result
    },
    async project(tx, scope, refs, lock = 'share') {
      const ids = [...new Set(refs.map((ref) => ref.memoryId))].sort()
      if (ids.length) await lockMemoryRows(tx, scope.familyId, ids, lock)
      const memories = ids.length ? await tx.memory.findMany({
        where: { id: { in: ids }, familyId: scope.familyId },
        include: sourceInclude,
      }) : []
      const byId = new Map(memories.map((memory) => [memory.id, memory]))
      return refs.map((ref) => {
        const memory = byId.get(ref.memoryId)
        const projected = memory && memory.status === 'published' && memory.deletedAt === null
          ? projectOne(memory, scope.familyId, ref)
          : null
        return projected?.available ? projected : {
          ...ref,
          id: ref.id ?? ref.sourceId,
          available: false,
          attachment: null,
          body: null,
          occurredAt: null,
        }
      })
    },
    async list(tx, scope, filter, limit, before) {
      const family = await tx.family.findFirst({ where: { id: scope.familyId, status: 'active' }, select: { timezone: true } })
      if (!family) throw new MemoryFailure('not_found', 'Семья не найдена')
      const from = filter.from ? localDateFloor(filter.from, family.timezone) : undefined
      const to = filter.to ? localDateCeiling(filter.to, family.timezone) : undefined
      const occurredAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      }
      const where: Prisma.MemoryWhereInput = {
        familyId: scope.familyId,
        status: 'published',
        deletedAt: null,
        ...(filter.kind === 'note' ? { kind: 'note' as const } : {}),
        ...(filter.kind === 'voice' ? { kind: 'voice' as const } : {}),
        ...(filter.kind === 'photo' ? { kind: { in: ['photo', 'media'] as const } } : {}),
        ...(filter.kind === 'video' ? { kind: { in: ['video', 'media'] as const } } : {}),
        ...(from || to ? { occurredAt } : {}),
        ...(before ? { OR: [
          { occurredAt: { lt: new Date(before.occurredAt) } },
          { occurredAt: new Date(before.occurredAt), id: { lt: before.id } },
        ] } : {}),
      }
      const memories = await tx.memory.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: sourceInclude,
      })
      const page = memories.slice(0, limit)
      const items = page.flatMap((memory) => {
        const sources = pickerSources(memory, scope.familyId, filter.kind)
        return sources.length ? [{ memoryId: memory.id, kind: memory.kind, occurredAt: memory.occurredAt.toISOString(), sources }] : []
      })
      const lastMemory = page.at(-1)
      return {
        items,
        hasNext: memories.length > limit,
        last: lastMemory ? { occurredAt: lastMemory.occurredAt.toISOString(), id: lastMemory.id } : null,
      }
    },
  }
}

function projectOne(memory: SourceMemory, familyId: string, ref: AlbumMemorySourceRef & { id?: string }): AlbumMemorySourceProjection | null {
  const base = { ...ref, id: ref.id ?? ref.sourceId, kind: 'note' as const, available: false, attachment: null, body: null, occurredAt: memory.occurredAt.toISOString() }
  if (ref.sourceKind === 'memory') {
    if (ref.sourceId !== memory.id || (memory.kind !== 'note' && memory.kind !== 'voice')) return null
    if (memory.kind === 'note') return { ...base, kind: 'note', available: true, body: memory.body }
    const attachment = allAttachments(memory, familyId).find(({ available }) => available)?.attachment ?? null
    return attachment ? { ...base, kind: 'voice', available: true, attachment } : null
  }
  if (ref.sourceKind === 'private_storage') {
    const relation = memory.media.find(({ asset }) => asset.id === ref.sourceId)
    if (!relation) return null
    const { asset } = relation
    const available = asset.originalStatus === 'stored' && asset.deletedAt === null && asset.purpose === 'memory'
    const attachment = available ? privateAttachment(memory, familyId, asset) : null
    return { ...base, kind: asset.mediaKind, available, attachment }
  }
  if (ref.sourceKind === 'max_video') {
    const source = memory.maxVideoReferences.find(({ id }) => id === ref.sourceId)
    if (!source) return null
    const thumb = source.thumbnailMedia
    const thumbReady = thumb && thumb.deletedAt === null && thumb.originalStatus === 'stored' && thumb.variants.some(({ variant }) => variant === 'display')
    const attachment = maxVideoAttachmentSchema.parse({
      id: source.id, source: 'max', kind: 'video', width: source.width, height: source.height, durationMs: source.durationMs,
      playbackPath: `/api/v1/families/${familyId}/media/max-videos/${source.id}/content`,
      posterState: thumbReady ? 'ready' : 'pending',
      posterPath: thumbReady ? `/api/v1/families/${familyId}/media/${thumb.id}/content?variant=display` : null,
    })
    return { ...base, kind: 'video', available: true, attachment }
  }
  const reference = memory.telegramVideoReference
  if (!reference || reference.id !== ref.sourceId) return null
  const thumbnail = reference.thumbnailMedia
  const attachment = telegramVideoAttachmentSchema.parse({
    id: reference.id, source: 'telegram', kind: 'video', width: reference.width, height: reference.height, durationMs: reference.durationMs,
    thumbnailPath: thumbnail && thumbnail.deletedAt === null && thumbnail.originalStatus === 'stored' && thumbnail.variants.some(({ variant }) => variant === 'display')
      ? `/api/v1/families/${familyId}/media/${thumbnail.id}/content?variant=display` : null,
    openInTelegramPath: `/api/v1/families/${familyId}/memories/${memory.id}/telegram-video`,
  })
  return { ...base, kind: 'video', available: true, attachment }
}

function pickerSources(memory: SourceMemory, familyId: string, kind: AlbumSourceFilter['kind']) {
  const all = allAttachments(memory, familyId)
  const candidates: AlbumMemorySourceProjection[] = []
  if ((memory.kind === 'note' || memory.kind === 'voice') && (!kind || kind === memory.kind)) {
    const ref = { memoryId: memory.id, sourceKind: 'memory' as const, sourceId: memory.id }
    const projected = projectOne(memory, familyId, ref)
    if (projected) candidates.push(projected)
  }
  for (const source of all) {
    if (source.available && (source.kind === 'photo' || source.kind === 'video')) {
      if (!kind || source.kind === kind) candidates.push(source)
    }
  }
  return candidates
}

function allAttachments(memory: SourceMemory, familyId: string): AlbumMemorySourceProjection[] {
  const sources: AlbumMemorySourceProjection[] = []
  for (const { asset } of memory.media) {
    const ref = { memoryId: memory.id, sourceKind: 'private_storage' as const, sourceId: asset.id }
    const item = projectOne(memory, familyId, ref)
    if (item) sources.push(item)
  }
  for (const { id } of memory.maxVideoReferences) {
    const ref = { memoryId: memory.id, sourceKind: 'max_video' as const, sourceId: id }
    const item = projectOne(memory, familyId, ref)
    if (item) sources.push(item)
  }
  if (memory.telegramVideoReference) {
    const ref = { memoryId: memory.id, sourceKind: 'telegram_video' as const, sourceId: memory.telegramVideoReference.id }
    const item = projectOne(memory, familyId, ref)
    if (item) sources.push(item)
  }
  return sources
}

function privateAttachment(memory: SourceMemory, familyId: string, asset: SourceMemory['media'][number]['asset']): MemoryAttachment {
  const variants = new Set(asset.variants.map(({ variant }) => variant))
  const path = (variant: string) => `/api/v1/families/${familyId}/media/${asset.id}/content?variant=${variant}`
  return mediaDtoSchema.parse({
    id: asset.id, source: 'private_storage', kind: asset.mediaKind, width: asset.width, height: asset.height,
    durationMs: asset.durationMs, renditionStatus: asset.renditionStatus,
    previewPath: variants.has('preview') ? path('preview') : null,
    displayPath: variants.has('display') ? path('display') : null,
    playbackPath: variants.has('playback') ? path('playback') : null,
    originalDownloadPath: `/api/v1/families/${familyId}/media/${asset.id}/content?variant=original`,
    waveform: waveform(asset.waveform),
  })
}

function waveform(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === 48 && value.every((n) => typeof n === 'number' && n >= 0 && n <= 1) ? value : null
}

async function lockMemories(tx: PrismaTransactionClient, familyId: string, memoryIds: string[], mode: 'share' | 'update') {
  const unique = [...new Set(memoryIds)].sort()
  const lock = mode === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM memories
     WHERE family_id = ${familyId}::uuid
       AND status = 'published' AND deleted_at IS NULL
       AND id IN (${Prisma.join(unique.map((id) => Prisma.sql`${id}::uuid`))})
     ORDER BY id ${lock}
  `)
  if (rows.length !== unique.length) throw unavailable()
}

async function lockMemoryRows(tx: PrismaTransactionClient, familyId: string, ids: string[], mode: 'share' | 'update') {
  const lock = mode === 'update' ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM memories WHERE family_id = ${familyId}::uuid
      AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id ${lock}
  `)
}
function localDateFloor(value: string, timezone: string) {
  const [year, month, day] = value.split('-').map(Number)
  return zonedInstant(year!, (month ?? 1) - 1, day ?? 1, 0, 0, 0, timezone)
}
function localDateCeiling(value: string, timezone: string) {
  const [year, month, day] = value.split('-').map(Number)
  const next = value.length === 4
    ? [year! + 1, 0, 1]
    : value.length === 7
      ? [year!, month!, 1]
      : [year!, month! - 1, day! + 1]
  return new Date(zonedInstant(next[0]!, next[1]!, next[2]!, 0, 0, 0, timezone).getTime() - 1)
}
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string) {
  let guess = new Date(0)
  guess.setUTCFullYear(year, month, day)
  guess.setUTCHours(hour, minute, second, 0)
  const target = guess.getTime()
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(guess)
    const fields = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)])) as Record<string, number>
    const represented = new Date(0)
    represented.setUTCFullYear(fields.year!, fields.month! - 1, fields.day!)
    represented.setUTCHours(fields.hour!, fields.minute!, fields.second!, 0)
    const delta = target - represented.getTime()
    if (!delta) break
    guess = new Date(guess.getTime() + delta)
  }
  return guess
}
function unavailable() { return new MemoryFailure('media_unavailable', 'Воспоминание или вложение недоступно') }

type SourceMemory = Prisma.MemoryGetPayload<{ include: typeof sourceInclude }>
