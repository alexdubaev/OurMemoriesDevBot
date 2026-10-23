/* eslint-disable typographyPolicy/use-typography-component -- semantic album detail follows its scoped stylesheet. */
import { useEffect, useRef, useState } from 'react'
import type { AlbumEntryDto, MemoryDto } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import { loadMemory, MixedMediaViewer, MemoryMediaScope, MediaPlaybackCoordinator } from '@/features/feed'
import { categories, dateLabel, monthAgeLabel, sourceKey, type AlbumSource } from './model'
import { SourcePreview } from './SourcePreview'

export function AlbumEntryDetail({ entry, accountId, membershipEpoch, scopeKey, transport, familyId, timezone, childName, hostBridge, active, onBack, onEdit, onRemove, onUpload, busy }: { entry: AlbumEntryDto; accountId: string; membershipEpoch: number; scopeKey: string; transport: AuthenticatedTransport; familyId: string; timezone: string; childName: string; hostBridge: HostBridge; active: boolean; onBack: () => void; onEdit: () => void; onRemove: () => void; onUpload?: () => void; busy: boolean }) {
  const [viewer, setViewer] = useState<{ memory: MemoryDto; index: number; sourceMemories: Record<string, MemoryDto> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  async function open(source: AlbumSource, element: HTMLElement) {
    if (!source.available) return
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    trigger.current = element; setLoading(true); setError(null)
    try {
      const memoryIds = [...new Set(entry.sources.filter((item) => item.available).map((item) => item.memoryId))]
      const fresh = await Promise.allSettled(memoryIds.map((id) => loadMemory(transport, familyId, id, request.signal)))
      if (request.signal.aborted) return
      const memories = new Map(fresh.flatMap((result) => result.status === 'fulfilled' ? [[result.value.id, result.value] as const] : []))
      const memory = memories.get(source.memoryId)
      if (!memory) { setError('Оригинал больше недоступен. Обновите альбом.'); return }
      const sourceMemories: Record<string, MemoryDto> = {}
      const attachments = entry.sources.flatMap((selected) => {
        const original = memories.get(selected.memoryId)
        if (!selected.available || !original) return []
        const media = selected.sourceKind === 'memory' ? original.attachments.filter((item) => item.kind === 'voice') : original.attachments.filter((item) => item.id === selected.sourceId && (selected.sourceKind === 'private_storage' ? item.source === 'private_storage' : selected.sourceKind === 'max_video' ? item.source === 'max' : item.source === 'telegram'))
        media.forEach((item) => { sourceMemories[item.id] = original })
        return media
      }).filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
      if (!attachments.length) { setError('Оригинал больше недоступен. Обновите альбом.'); return }
      const requestedId = source.sourceKind === 'memory' ? memory.attachments.find((item) => item.kind === 'voice')?.id : source.sourceId
      const index = attachments.findIndex((item) => item.id === requestedId)
      if (index < 0) { setError('Этот материал больше недоступен. Обновите альбом.'); return }
      setViewer({ memory: { ...memory, attachments }, index, sourceMemories })
    } catch { if (!request.signal.aborted) setError('Не удалось открыть оригинал. Проверьте соединение и повторите.') }
    finally { if (!request.signal.aborted) setLoading(false) }
  }
  return <MemoryMediaScope accountId={accountId} membershipEpoch={membershipEpoch}><MediaPlaybackCoordinator active={active}>
    <section className="albums-entry-detail"><header className="albums-toolbar"><button disabled={busy} onClick={onBack} type="button">‹ Назад</button><h1>{entry.title || (entry.monthNumber ? monthAgeLabel(entry.monthNumber) : 'Маленькое творение')}</h1></header>
      <p className="albums-kicker">{dateLabel(entry.date)}{entry.category ? ` · ${categories[entry.category]}` : ''}</p>
      {entry.caption ? <p className="albums-story">{entry.caption}</p> : null}{entry.childQuote ? <blockquote>«{entry.childQuote}»</blockquote> : null}
      <div className="albums-detail-sources">{entry.sources.map((source, index) => <article key={sourceKey(source)}>{source.kind === 'note' && source.available ? <p className="albums-note">{source.body || 'Заметка без текста'}</p> : <button aria-label={`Открыть ${source.kind === 'voice' ? 'голосовое' : 'материал'} ${index + 1}`} disabled={!source.available || loading} onClick={(event) => void open(source, event.currentTarget)} type="button"><SourcePreview accountId={accountId} active={active} scopeKey={scopeKey} source={source} transport={transport} /></button>}{!source.available ? <p>Оригинал недоступен</p> : null}</article>)}</div>
      {loading ? <p role="status">Открываем оригинал…</p> : null}{error ? <p className="albums-error" role="alert">{error}</p> : null}
      {entry.capabilities.edit ? <div className="albums-form-actions"><button className="albums-primary" disabled={busy} onClick={onEdit} type="button">Изменить</button>{onUpload ? <button className="albums-secondary" disabled={busy} onClick={onUpload} type="button">Загрузить новое</button> : null}<button className="albums-danger" disabled={busy} onClick={onRemove} type="button">{entry.kind === 'month' ? 'Очистить главу' : 'Убрать из альбома'}</button></div> : null}
    </section>
    {active && viewer ? <MixedMediaViewer childName={childName} familyTimezone={timezone} hostBridge={hostBridge} index={viewer.index} memory={viewer.memory} onClose={() => setViewer(null)} onIndexChange={(index) => setViewer((current) => current ? { ...current, index } : current)} preferReturnFocus returnFocusRef={trigger} sourceMemories={viewer.sourceMemories} transport={transport} /> : null}
  </MediaPlaybackCoordinator></MemoryMediaScope>
}
