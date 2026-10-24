/* eslint-disable typographyPolicy/use-typography-component -- accessible native form controls and album headings. */
import { useEffect, useRef, useState } from 'react'
import type { AlbumsApi } from './api'
import type { AuthenticatedTransport } from '@/platform/api'
import { sourceKey, type AlbumSource } from './model'
import { SourcePreview } from './SourcePreview'

export function SourcePicker({ api, initial, photosOnly = false, accountId, scopeKey, transport, onCancel, onChoose, suggestion }: { api: AlbumsApi; initial: AlbumSource[]; photosOnly?: boolean; accountId: string; scopeKey: string; transport: AuthenticatedTransport; onCancel: () => void; onChoose: (sources: AlbumSource[]) => void; suggestion?: { from: string; to: string } | null }) {
  const [selected, setSelected] = useState(() => new Map(initial.map((source) => [sourceKey(source), source])))
  const [kind, setKind] = useState<'photo' | 'video' | 'voice' | 'note' | undefined>(photosOnly ? 'photo' : undefined)
  const [candidates, setCandidates] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<AlbumSource[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const generation = useRef(0)
  const inFlight = useRef(false)
  async function load(more = false) {
    if (inFlight.current) return
    const version = generation.current; inFlight.current = true; setBusy(true); setError(false)
    try {
      const page = await api.picker(kind, more ? cursor ?? undefined : undefined, candidates ? suggestion?.from : undefined, candidates ? suggestion?.to : undefined)
      if (version !== generation.current) return
      setItems((old) => [...new Map([...(more ? old : []), ...page.items.flatMap((item) => item.sources)].map((source) => [sourceKey(source), source])).values()]); setCursor(page.nextCursor)
    } catch { if (version === generation.current) setError(true) }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false) } }
  }
  function changeKind(value: typeof kind) {
    if (value === kind) return
    generation.current += 1; inFlight.current = false; setItems([]); setCursor(null); setError(false); setBusy(true); setKind(value)
  }
  function changeCandidates(value: boolean) {
    if (value === candidates) return
    generation.current += 1; inFlight.current = false; setItems([]); setCursor(null); setError(false); setBusy(true); setCandidates(value)
  }
  useEffect(() => {
    const version = ++generation.current
    inFlight.current = true
    void api.picker(kind, undefined, candidates ? suggestion?.from : undefined, candidates ? suggestion?.to : undefined).then((page) => {
      if (version !== generation.current) return
      setItems([...new Map(page.items.flatMap((item) => item.sources).map((source) => [sourceKey(source), source])).values()]); setCursor(page.nextCursor); setError(false)
    }).catch(() => { if (version === generation.current) setError(true) }).finally(() => {
      if (version === generation.current) { inFlight.current = false; setBusy(false) }
    })
    return () => { generation.current += 1; inFlight.current = false }
    // Only filter changes restart this scoped read; selection remains independent of page/filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, kind, candidates])
  const visible = items.filter((source) => !query.trim() || `${source.body ?? ''} ${source.occurredAt ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <section aria-label="Выбор из воспоминаний" className="albums-picker">
    <header className="albums-toolbar"><button onClick={onCancel} type="button">‹ Назад</button><h1>Выбрать материалы</h1></header>
    <p className="albums-muted">Выберите конкретные кадры. Оригиналы останутся в ленте.</p>
    {!photosOnly ? <div aria-label="Тип материала" className="albums-chips">{([undefined, 'photo', 'video', 'voice', 'note'] as const).map((value, index) => <button aria-pressed={kind === value} key={value ?? 'all'} onClick={() => changeKind(value)} type="button">{['Все', 'Фото', 'Видео', 'Голос', 'Заметки'][index]}</button>)}</div> : null}
    {suggestion ? <div className="albums-chips"><button aria-pressed={!candidates} onClick={() => changeCandidates(false)} type="button">Все воспоминания</button><button aria-pressed={candidates} onClick={() => changeCandidates(true)} type="button">Подсказка по возрасту</button></div> : null}
    <label className="albums-field">Поиск по загруженным материалам<input onChange={(event) => setQuery(event.target.value)} placeholder="Текст или дата" type="search" value={query} /></label>
    <p aria-live="polite" className="albums-muted">Выбрано {selected.size} из 96 · загружено {items.length}</p>
    <div className="albums-picker-grid">{visible.map((source, index) => <button aria-label={`${source.kind === 'photo' ? 'Фото' : source.kind === 'video' ? 'Видео' : source.kind === 'voice' ? 'Голос' : 'Заметка'} ${index + 1}${source.body ? `: ${source.body.slice(0, 50)}` : ''}`} aria-pressed={selected.has(sourceKey(source))} className="albums-picker-item" key={sourceKey(source)} onClick={() => setSelected((current) => { const next = new Map(current); const key = sourceKey(source); if (next.has(key)) next.delete(key); else if (next.size < 96) next.set(key, source); return next })} type="button"><SourcePreview accountId={accountId} scopeKey={scopeKey} source={source} transport={transport} />{source.body ? <span>{source.body.slice(0, 90)}</span> : null}{selected.has(sourceKey(source)) ? <span className="albums-selected-mark" aria-hidden>✓</span> : null}</button>)}</div>
    {!busy && !error && !visible.length ? <p>Материалов пока нет. Попробуйте другой фильтр.</p> : null}
    {busy ? <p aria-live="polite" role="status">Загружаем материалы…</p> : null}
    {error ? <div className="albums-error" role="alert"><p>Не удалось загрузить материалы. Выбор сохранён.</p><button onClick={() => void load(Boolean(items.length))} type="button">Повторить загрузку</button></div> : null}
    {cursor && !busy ? <button className="albums-secondary" onClick={() => void load(true)} type="button">Ещё материалы</button> : null}
    <footer className="albums-form-actions"><button className="albums-primary" onClick={() => onChoose([...selected.values()])} type="button">Готово · {selected.size}</button><button onClick={onCancel} type="button">Отмена</button></footer>
  </section>
}
