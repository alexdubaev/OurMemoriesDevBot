/* eslint-disable typographyPolicy/use-typography-component -- native labelled form fields use the album typography. */
import { useRef, useState } from 'react'
import type { AlbumDto, AlbumEntryDto, CreateAlbumEntryRequest, MemoryDto } from '@web-app-demo/contracts'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { AlbumsApi } from './api'
import { albumPhotoSources, categories, dateLabel, memorySources, monthAgeLabel, sourceDate, sourceKey, sourceRefs, type AlbumSource } from './model'
import { SourcePicker } from './SourcePicker'
import { SourcePreview } from './SourcePreview'

type Props = { album: AlbumDto; entry: AlbumEntryDto | null; title?: string; api: AlbumsApi; accountId: string; scopeKey: string; transport: AuthenticatedTransport; timezone: string; birthDate?: string | null; canUpload: boolean; onUpload: (attachMemory: (memory: MemoryDto) => Promise<void>, attachPhotos: (mediaIds: string[]) => Promise<void>) => void; onCancel: () => void; onSaved: (version: number) => void }
export function EntryEditor(props: Props) {
  const { album, entry, api, accountId, scopeKey, transport, timezone } = props
  const [title, setTitle] = useState(entry?.title ?? props.title ?? '')
  const [caption, setCaption] = useState(entry?.caption ?? '')
  const [quote, setQuote] = useState(entry?.childQuote ?? '')
  const [category, setCategory] = useState<AlbumEntryDto['category']>(entry?.category ?? 'drawing')
  const [precision, setPrecision] = useState<AlbumEntryDto['date']['precision']>(entry?.date.precision ?? 'unknown')
  const [value, setValue] = useState(entry?.date.value ?? '')
  const [sources, setSources] = useState(entry?.sources ?? [])
  const [picker, setPicker] = useState(false)
  const [separate, setSeparate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [currentVersion, setCurrentVersion] = useState(album.version)
  const saving = useRef(false)
  type Attempt = { inputs: CreateAlbumEntryRequest[]; keys: string[]; next: number; version: number; metadataSaved: boolean; sourceInput?: { expectedVersion: number; sources: ReturnType<typeof sourceRefs> }; sourceKey: string }
  const attempt = useRef<Attempt | null>(null)
  const workshop = album.kind === 'workshop'
  const event = album.kind === 'events'
  const date = precision === 'unknown' ? { precision, value: null } as const : { precision, value } as AlbumEntryDto['date']
  function choose(next: AlbumSource[]) {
    setSources(next); setPicker(false)
    if (precision === 'unknown' && next[0]?.occurredAt && !entry) { const suggested = sourceDate(next[0], timezone); setPrecision(suggested.precision); setValue(suggested.value ?? '') }
  }
  async function save(uploaded?: AlbumSource[], propagate = false) {
    if (saving.current || conflict) return
    const chosen = uploaded ?? sources
    setError(null)
    if (!attempt.current) {
      if ([...title.trim()].length > 120 || [...caption].length > 8000 || [...quote].length > 8000) { setError('Проверьте длину текста.'); return }
      if (event && (!title.trim() || (!caption.trim() && !chosen.some((source) => source.available)))) { setError('Добавьте название и историю или материал.'); if (propagate) throw new Error('Добавьте название события'); return }
      if (workshop && !chosen.some((source) => source.available && source.kind === 'photo')) { setError('Для работы нужна хотя бы одна фотография.'); if (propagate) throw new Error('Нужна фотография'); return }
      const chosenDate = uploaded && date.precision === 'unknown' && !entry && chosen[0] ? sourceDate(chosen[0], timezone) : date
      const base: CreateAlbumEntryRequest = { expectedVersion: currentVersion, kind: event ? 'event' : 'work', title: title.trim() || null, caption: caption.trim() || null, childQuote: workshop ? quote.trim() || null : null, category: workshop ? category : null, date: chosenDate, sources: sourceRefs(chosen) }
      const inputs = workshop && !entry && separate && chosen.length > 1 ? chosen.map((source) => ({ ...base, date: source.memoryId === null && source.sourceKind === 'private_storage' && date.precision !== 'unknown' ? date : sourceDate(source, timezone), sources: sourceRefs([source]) })) : [base]
      attempt.current = { inputs, keys: inputs.map(() => crypto.randomUUID()), next: 0, version: currentVersion, metadataSaved: false, sourceKey: crypto.randomUUID() }
    }
    const operation = attempt.current; saving.current = true; setBusy(true); setLocked(true)
    try {
      if (!entry) {
        while (operation.next < operation.inputs.length) {
          const index = operation.next
          const input = operation.inputs[index]
          // Freeze each submitted payload across ambiguous network retries; only the next item takes the new version.
          const result = await api.createEntry(album.id, input, operation.keys[index])
          operation.version = result.entry.aggregateVersion; operation.next += 1; setCompleted(operation.next)
          if (operation.inputs[operation.next]) operation.inputs[operation.next].expectedVersion = operation.version
        }
      } else {
        const input = operation.inputs[0]
        if (!operation.metadataSaved) {
          const result = await api.updateEntry(album.id, entry.id, { expectedVersion: operation.version, title: input.title, caption: input.caption, childQuote: input.childQuote, category: input.category, date: input.date })
          operation.version = result.entry.aggregateVersion; operation.metadataSaved = true
        }
        if (JSON.stringify(sourceRefs(entry.sources)) !== JSON.stringify(input.sources)) {
          operation.sourceInput ??= { expectedVersion: operation.version, sources: input.sources }
          const result = await api.sources(album.id, entry.id, operation.sourceInput, operation.sourceKey)
          operation.version = result.entry.aggregateVersion
        }
      }
      props.onSaved(operation.version)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const isConflict = reason instanceof ApiRequestError && reason.status === 409
      setConflict(isConflict)
      setError(isConflict ? 'Альбом уже изменили. Обновите данные перед новым сохранением.' : operation.metadataSaved ? 'Текст сохранён. Материалы пока не прикреплены. Повторите только прикрепление.' : operation.next ? `Сохранено работ: ${operation.next}. Остальные ещё не добавлены; повторим только их.` : 'Не удалось подтвердить сохранение. Повторите тот же запрос.')
      if (reason instanceof ApiRequestError && reason.status === 422 && !operation.metadataSaved && operation.next === 0) { attempt.current = null; setLocked(false); setError('Проверьте поля и дату. Работа должна содержать фото, событие — название и историю или материал.') }
      if (propagate) throw reason
    } finally { saving.current = false; setBusy(false) }
  }
  const suggestion = (() => {
    if (!entry?.monthNumber || !props.birthDate) return null
    const born = props.birthDate.slice(0, 10); const [year, month, day] = born.split('-').map(Number)
    if (!year || !month || !day) return null
    const from = new Date(Date.UTC(year, month - 1 + entry.monthNumber - 1, 1)).toISOString().slice(0, 10)
    const to = new Date(Date.UTC(year, month - 1 + entry.monthNumber + 1, 0)).toISOString().slice(0, 10)
    return { from, to }
  })()
  if (picker) return <SourcePicker accountId={accountId} api={api} initial={sources} onCancel={() => setPicker(false)} onChoose={choose} photosOnly={workshop} scopeKey={scopeKey} suggestion={suggestion} transport={transport} />
  return <section className="albums-editor">
    <header className="albums-toolbar"><button disabled={busy} onClick={props.onCancel} type="button">‹ Назад</button><h1>{entry?.kind === 'month' ? monthAgeLabel(entry.monthNumber!) : entry ? 'Изменить историю' : workshop ? 'Добавить работу' : 'Новая история'}</h1></header>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy || locked}>
        <label className="albums-field">{event ? 'Название события' : 'Название (необязательно)'}<input maxLength={240} onChange={(event) => setTitle(event.target.value)} required={event} value={title} /><small>{[...title].length}/120</small></label>
        <label className="albums-field">История<textarea onChange={(event) => setCaption(event.target.value)} rows={5} value={caption} /><small>{[...caption].length}/8000</small></label>
        <label className="albums-field">Когда это было<select onChange={(event) => { setPrecision(event.target.value as typeof precision); setValue('') }} value={precision}><option value="unknown">Не помню дату</option><option value="day">Точная дата</option><option value="month">Месяц</option><option value="year">Год</option></select></label>
        {precision !== 'unknown' ? <label className="albums-field">{precision === 'day' ? 'Дата' : precision === 'month' ? 'Месяц и год' : 'Год'}<input max={precision === 'year' ? '9999' : undefined} min={precision === 'year' ? '1' : undefined} onChange={(event) => setValue(event.target.value)} required type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'number'} value={value} /></label> : null}
        {workshop ? <><label className="albums-field">Категория<select onChange={(event) => setCategory(event.target.value as typeof category)} value={category ?? 'other'}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="albums-field">Слова ребёнка<textarea onChange={(event) => setQuote(event.target.value)} rows={3} value={quote} /><small>{[...quote].length}/8000</small></label></> : null}
        <h2>Материалы · {sources.length}</h2>
        <div className="albums-selected-sources">{sources.map((source, index) => <div key={sourceKey(source)}><SourcePreview accountId={accountId} scopeKey={scopeKey} source={source} transport={transport} /><button aria-label={`Убрать материал ${index + 1}`} onClick={() => setSources((current) => current.filter((item) => sourceKey(item) !== sourceKey(source)))} type="button">Убрать</button>{index > 0 ? <button aria-label={`Сделать материал ${index + 1} главным`} onClick={() => setSources([source, ...sources.filter((item) => sourceKey(item) !== sourceKey(source))])} type="button">Главный</button> : <small>Главный</small>}</div>)}</div>
        <button className="albums-secondary" onClick={() => setPicker(true)} type="button">Выбрать из воспоминаний</button>
        {props.canUpload ? <button className="albums-secondary" onClick={() => props.onUpload(async (memory) => { const next = [...new Map([...sources, ...memorySources(memory)].map((source) => [sourceKey(source), source])).values()]; setSources(next); await save(next, true) }, async (mediaIds) => { const next = [...new Map([...sources, ...albumPhotoSources(mediaIds)].map((source) => [sourceKey(source), source])).values()]; setSources(next); await save(next, true) })} type="button">Загрузить новое</button> : null}
        {workshop && !entry && sources.length > 1 ? <label className="albums-checkbox"><input checked={separate} onChange={(event) => setSeparate(event.target.checked)} type="checkbox" />Каждое фото — отдельная работа. Снимите отметку для ракурсов одной работы.</label> : null}
        <p className="albums-muted">{dateLabel(date)} · Убирается только связь с альбомом, оригиналы сохраняются.</p>
      </fieldset>
      {completed ? <p role="status">Сохранено работ: {completed}</p> : null}
      {error ? <p className="albums-error" role="alert">{error}</p> : null}
      {conflict ? <button className="albums-secondary" disabled={busy} onClick={() => { setBusy(true); void Promise.all([api.album(album.id), entry ? api.entry(album.id, entry.id) : Promise.resolve(null)]).then(([fresh, detail]) => { setCurrentVersion(fresh.album.version); if (detail) { setTitle(detail.entry.title ?? ''); setCaption(detail.entry.caption ?? ''); setSources(detail.entry.sources); setQuote(detail.entry.childQuote ?? ''); setCategory(detail.entry.category); setPrecision(detail.entry.date.precision); setValue(detail.entry.date.value ?? '') } attempt.current = null; setConflict(false); setLocked(false); setError(null) }).catch(() => setError('Не удалось обновить данные. Повторите загрузку.')).finally(() => setBusy(false)) }} type="button">Обновить данные</button> : <button className="albums-primary" disabled={busy} type="submit">{busy ? 'Сохраняем…' : locked ? 'Повторить сохранение' : 'Сохранить'}</button>}
      <button disabled={busy} onClick={props.onCancel} type="button">Отмена</button>
    </form>
  </section>
}
