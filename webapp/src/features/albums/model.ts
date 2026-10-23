import type { AlbumEntryDto, AlbumSourceSelection, MemoryDto } from '@web-app-demo/contracts'

export type AlbumSource = AlbumEntryDto['sources'][number]
export type SourceRef = AlbumSourceSelection['sources'][number]
export const sourceKey = (source: SourceRef) => `${source.memoryId}:${source.sourceKind}:${source.sourceId}`
export const sourceRefs = (sources: SourceRef[]) => sources.map(({ memoryId, sourceKind, sourceId }) => ({ memoryId, sourceKind, sourceId }))
export const filled = (entry: AlbumEntryDto) => Boolean(entry.caption?.trim() || entry.sources.some((source) => source.available))
export const categories = { drawing: 'Рисунки', applique: 'Аппликации', craft: 'Поделки', building: 'Постройки', other: 'Другое' } as const
export const kindNames = { year: 'Первый год', events: 'Первые открытия', workshop: 'Мастерская', free: 'Свободный альбом' } as const
export const suggestions = ['Первая улыбка', 'Первое слово', 'Первый зубик', 'Первые шаги', 'Первый переворот']
export const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const monthGenitiveNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export function monthAgeLabel(monthNumber: number) {
  const lastTwo = monthNumber % 100
  const last = monthNumber % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'месяцев' : last === 1 ? 'месяц' : last >= 2 && last <= 4 ? 'месяца' : 'месяцев'
  return `Нам ${monthNumber} ${word}`
}
export function dateLabel(date: AlbumEntryDto['date']) {
  if (date.precision === 'unknown') return 'Не помню дату'
  if (!date.value || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date.value)) return 'Выберите дату'
  if (date.precision === 'year') return `${date.value} год`
  const [year, month, day] = date.value.split('-')
  return date.precision === 'month' ? `${monthNames[Number(month) - 1]} ${year}` : `${Number(day)} ${monthGenitiveNames[Number(month) - 1]} ${year}`
}
export function sourceDate(source: Pick<AlbumSource, 'occurredAt'>, timezone: string): AlbumEntryDto['date'] {
  if (!source.occurredAt) return { precision: 'unknown', value: null }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(source.occurredAt))
  const part = (name: string) => parts.find((p) => p.type === name)?.value
  return { precision: 'day', value: `${part('year')}-${part('month')}-${part('day')}` }
}
export function memorySources(memory: MemoryDto): AlbumSource[] {
  if (memory.kind === 'note' || memory.kind === 'voice') return [{ id: memory.id, memoryId: memory.id, sourceKind: 'memory', sourceId: memory.id, kind: memory.kind, attachment: memory.attachments.find((item) => item.kind === 'voice') ?? null, body: memory.body, available: true, occurredAt: memory.occurredAt }]
  return memory.attachments.map((attachment) => ({ id: attachment.id, memoryId: memory.id, sourceId: attachment.id, sourceKind: attachment.source === 'max' ? 'max_video' : attachment.source === 'telegram' ? 'telegram_video' : 'private_storage', kind: attachment.kind, attachment, body: null, occurredAt: memory.occurredAt })) .map((source) => ({ ...source, available: true })) as AlbumSource[]
}
export function previewPath(source?: AlbumSource | null) {
  if (!source?.available || !source.attachment) return null
  const attachment = source.attachment
  if (attachment.source === 'private_storage') return attachment.previewPath
  if (attachment.source === 'max') return attachment.posterState === 'ready' ? attachment.posterPath ?? null : null
  return attachment.thumbnailPath
}
export function coverSource(sources: AlbumSource[]) { return sources.find((s) => s.available && (s.kind === 'photo' || s.kind === 'video')) ?? null }

export const zoomLevels = [{ columns: 8, label: 'Обзор' }, { columns: 5, label: 'Коллаж' }, { columns: 3, label: 'Крупно' }] as const
export function zoomLevel(level: number, delta: number) { return Math.max(0, Math.min(2, level + Math.sign(delta))) }
const hash = (id: string) => [...id].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0)
export type Tile = { id: string; index: number; x: number; y: number; width: number; height: number }
export type WorkshopLayout = { tiles: Tile[]; headings: { y: number; title: string }[]; height: number }
/** Shelf packing preserves source reading order; it never fills earlier holes with later photos. */
export function workshopLayout(entries: AlbumEntryDto[], columns: number, width: number): WorkshopLayout {
  const gap = 3
  const cell = Math.max(1, (width - (columns - 1) * gap) / columns)
  const tiles: Tile[] = []; const headings: WorkshopLayout['headings'] = []
  let y = 0; let col = 0; let shelfHeight = 0; let group = ''; let shelfStart = 0
  const flush = () => {
    if (!shelfHeight) return
    for (let index = shelfStart; index < tiles.length; index += 1) tiles[index].height = shelfHeight - gap
    // Fill a trailing shelf edge rather than leaving a blank column before the next accent.
    const last = tiles.at(-1)
    if (last && col < columns) last.width = width - last.x
    y += shelfHeight; col = 0; shelfHeight = 0; shelfStart = tiles.length
  }
  entries.forEach((entry, index) => {
    const nextGroup = entry.date.precision === 'unknown' ? 'Без даты' : entry.date.precision === 'year' ? `${entry.date.value} · Без месяца` : `${monthNames[Number(entry.date.value.slice(5, 7)) - 1]} ${entry.date.value.slice(0, 4)}`
    if (nextGroup !== group) {
      flush(); group = nextGroup
      headings.push({ y, title: group }); y += 48
    }
    const photo = coverSource(entry.sources)?.attachment
    const ratio = photo?.width && photo.height ? photo.width / photo.height : 1
    const accent = hash(entry.id) % 13 === 0
    const wide = columns > 3 && (ratio > 1.4 || accent) ? 2 : 1
    const tall = ratio < .78 || accent ? 2 : 1
    if (col + wide > columns) flush()
    tiles.push({ id: entry.id, index, x: col * (cell + gap), y, width: wide * cell + (wide - 1) * gap, height: tall * cell + (tall - 1) * gap })
    shelfHeight = Math.max(shelfHeight, tall * (cell + gap)); col += wide
    if (col === columns) flush()
  })
  flush()
  return { tiles, headings, height: y }
}
/** A hard bound also protects extreme zoom-out and unusually tall browser windows. */
export function visibleTiles(layout: WorkshopLayout, top: number, height: number) {
  const margin = Math.min(500, height / 2)
  return layout.tiles.filter((tile) => tile.y + tile.height >= top - margin && tile.y <= top + height + margin).slice(0, 320)
}
