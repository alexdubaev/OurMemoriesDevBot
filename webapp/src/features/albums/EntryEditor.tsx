/* eslint-disable typographyPolicy/use-typography-component -- native labelled form fields use the album typography. */
import { useEffect, useRef, useState } from 'react'
import type { AlbumDto, AlbumEntryDto, AlbumSourceChanges, CreateAlbumEntryRequest, MemoryDto } from '@web-app-demo/contracts'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { AlbumsApi } from './api'
import { albumPhotoSources, categories, dateLabel, memorySources, monthAgeLabel, sourceDate, sourceKey, sourceRefs, type AlbumSource } from './model'
import { SourcePicker } from './SourcePicker'
import { SourcePreview } from './SourcePreview'

type Props = { album: AlbumDto; entry: AlbumEntryDto | null; title?: string; api: AlbumsApi; accountId: string; scopeKey: string; transport: AuthenticatedTransport; timezone: string; canUpload: boolean; onUpload: (attachMemory: (memory: MemoryDto) => Promise<void>, attachPhotos: (mediaIds: string[]) => Promise<void>, complete: () => void) => void; onCancel: () => void; onSaved: (version: number, monthEntry?: AlbumEntryDto) => void }
export function EntryEditor(props: Props) {
  const { album, entry, api, accountId, scopeKey, transport, timezone } = props
  const [title, setTitle] = useState(entry?.title ?? props.title ?? '')
  const [caption, setCaption] = useState(entry?.caption ?? '')
  const [quote, setQuote] = useState(entry?.childQuote ?? '')
  const [category, setCategory] = useState<AlbumEntryDto['category']>(entry?.category ?? 'drawing')
  const [precision, setPrecision] = useState<AlbumEntryDto['date']['precision']>(entry?.date.precision ?? 'unknown')
  const [value, setValue] = useState(entry?.date.value ?? '')
  const [sources, setSources] = useState(entry?.collection ? [] : entry?.sources ?? [])
  const [sourcePage, setSourcePage] = useState(0)
  const [sourceCursor, setSourceCursor] = useState<string | null>(null)
  const [sourceLoading, setSourceLoading] = useState(Boolean(entry?.collection))
  const [sourceError, setSourceError] = useState(false)
  const [picker, setPicker] = useState(false)
  const [separate, setSeparate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [completed, setCompleted] = useState(0)
  const saving = useRef(false)
  type Change = Omit<AlbumSourceChanges, 'expectedVersion'>
  type Attempt = { inputs: CreateAlbumEntryRequest[]; keys: string[]; next: number; version: number; metadataSaved: boolean; target: AlbumEntryDto | null; changes: Change[]; changeKeys: string[]; changeNext: number; creating: boolean; chosen: AlbumSource[] }
  const attempt = useRef<Attempt | null>(null)
  const savedTarget = useRef(entry)
  const savedVersion = useRef(album.version)
  const uploadSaved = useRef(false)
  const baseline = useRef(new Map((entry?.collection ? [] : entry?.sources ?? []).map((source) => [sourceKey(source), source.id])))
  const removed = useRef(new Set<string>())
  const promoted = useRef<AlbumSource | null>(null)
  const read = useRef<AbortController | null>(null)
  const workshop = album.kind === 'workshop'
  const event = album.kind === 'events'
  const month = entry?.kind === 'month'
  const date = precision === 'unknown' ? { precision, value: null } as const : { precision, value } as AlbumEntryDto['date']
  async function loadSources(cursor?: string) {
    if (!entry?.collection || read.current) return
    const controller = new AbortController()
    read.current = controller; setSourceLoading(true); setSourceError(false)
    try {
      const response = await api.monthSources(album.id, entry.id, 'all', cursor, controller.signal)
      if (controller.signal.aborted) return
      response.items.forEach((source) => baseline.current.set(sourceKey(source), source.id))
      setSources((old) => [...new Map([...old, ...response.items.filter(({ id }) => !removed.current.has(id))].map((source) => [sourceKey(source), source])).values()])
      setSourceCursor(response.nextCursor)
    } catch { if (!controller.signal.aborted) setSourceError(true) }
    finally { if (read.current === controller) { read.current = null; setSourceLoading(false) } }
  }
  useEffect(() => {
    void loadSources()
    return () => { read.current?.abort(); read.current = null }
    // The scoped editor is keyed by entry. Further pages keep pending selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, entry?.id])
  function choose(next: AlbumSource[]) {
    setSources((old) => [...new Map([...old, ...next].map((source) => [sourceKey(source), source])).values()]); setPicker(false)
    if (precision === 'unknown' && next[0]?.occurredAt && !entry) { const suggested = sourceDate(next[0], timezone); setPrecision(suggested.precision); setValue(suggested.value ?? '') }
  }
  function removeSource(source: AlbumSource) {
    const id = baseline.current.get(sourceKey(source))
    if (id) removed.current.add(id)
    if (promoted.current && sourceKey(promoted.current) === sourceKey(source)) promoted.current = null
    setSources((old) => old.filter((item) => sourceKey(item) !== sourceKey(source)))
  }
  function startUpload() {
    let uploaded = sources
    let initialSelection = sources
    props.onUpload(async (memory) => {
      uploaded = [...new Map([...uploaded, ...memorySources(memory)].map((source) => [sourceKey(source), source])).values()]
      await save(uploaded, true, true)
    }, async (mediaIds) => {
      const next = workshop && !entry && separate ? [...initialSelection, ...albumPhotoSources(mediaIds)] : [...new Map([...uploaded, ...albumPhotoSources(mediaIds)].map((source) => [sourceKey(source), source])).values()]
      await save(next, true, true)
      initialSelection = []
      uploaded = next
    }, () => { if (uploadSaved.current) props.onSaved(savedVersion.current) })
  }
  async function save(uploaded?: AlbumSource[], propagate = false, keepOpen = false) {
    if (saving.current || conflict || sourceLoading || sourceError) { if (propagate) throw new Error('Загрузите материалы перед добавлением'); return }
    const chosen = uploaded && workshop && !entry && separate
      ? uploaded.filter((source) => !baseline.current.has(sourceKey(source)))
      : uploaded ?? sources
    const target = savedTarget.current
    if (uploaded && workshop && !entry && separate && !chosen.length) return
    setError(null)
    if (!attempt.current) {
      if ([...title.trim()].length > 120 || [...caption].length > 8000 || [...quote].length > 8000) { setError('Проверьте длину текста.'); if (propagate) throw new Error('Проверьте длину текста'); return }
      const hasExistingSources = Boolean(target && target.sourceCount > removed.current.size)
      if (event && (!title.trim() || (!caption.trim() && !chosen.some((source) => source.available) && !hasExistingSources))) { setError('Добавьте название и историю или материал.'); if (propagate) throw new Error('Добавьте название события'); return }
      if (workshop && !chosen.some((source) => source.available && source.kind === 'photo') && !hasExistingSources) { setError('Для работы нужна хотя бы одна фотография.'); if (propagate) throw new Error('Нужна фотография'); return }
      const chosenDate = uploaded && date.precision === 'unknown' && !entry && chosen[0] ? sourceDate(chosen[0], timezone) : date
      const base: CreateAlbumEntryRequest = { expectedVersion: savedVersion.current, kind: event ? 'event' : 'work', title: title.trim() || null, caption: caption.trim() || null, childQuote: workshop ? quote.trim() || null : null, category: workshop ? category : null, date: chosenDate, sources: sourceRefs(chosen) }
      const split = workshop && !target && separate
      const inputs = split ? chosen.map((source) => ({ ...base, date: source.memoryId === null && source.sourceKind === 'private_storage' && date.precision !== 'unknown' ? date : sourceDate(source, timezone), sources: sourceRefs([source]) })) : [base]
      const additions = target ? chosen.filter((source) => !baseline.current.has(sourceKey(source))) : split ? [] : chosen.slice(48)
      const deletions = [...removed.current]
      const changes: Change[] = []
      for (let offset = 0; offset < Math.max(additions.length, deletions.length); offset += 48) changes.push({ add: sourceRefs(additions.slice(offset, offset + 48)), removeIds: deletions.slice(offset, offset + 48) })
      if (target && promoted.current) changes.push({ add: [], removeIds: [], firstSource: sourceRefs([promoted.current])[0] })
      attempt.current = { inputs, keys: inputs.map(() => crypto.randomUUID()), next: 0, version: savedVersion.current, metadataSaved: false, target, creating: !target, changes, changeKeys: changes.map(() => crypto.randomUUID()), changeNext: 0, chosen }
    }
    const operation = attempt.current; saving.current = true; setBusy(true); setLocked(true)
    let continueUpload = false
    try {
      let monthEntry: AlbumEntryDto | undefined
      if (operation.creating) {
        while (operation.next < operation.inputs.length) {
          const index = operation.next
          const input = operation.inputs[index]
          // Freeze each submitted payload across ambiguous network retries; only the next item takes the new version.
          const result = await api.createEntry(album.id, { ...input, sources: input.sources.slice(0, 48) }, operation.keys[index])
          operation.target = result.entry; operation.version = result.entry.aggregateVersion; operation.next += 1; setCompleted((count) => count + 1)
          if (operation.inputs[operation.next]) operation.inputs[operation.next].expectedVersion = operation.version
        }
      } else {
        const input = operation.inputs[0]
        if (!operation.metadataSaved) {
          const result = await api.updateEntry(album.id, operation.target!.id, { expectedVersion: operation.version, title: input.title, caption: input.caption, ...(!month ? { childQuote: input.childQuote, category: input.category } : {}), date: input.date }, month)
          operation.target = result.entry; operation.version = result.entry.aggregateVersion; operation.metadataSaved = true
          if (month) monthEntry = result.entry
        }
      }
      while (!month && operation.changeNext < operation.changes.length) {
        const index = operation.changeNext
        const result = await api.changeSources(album.id, operation.target!.id, { ...operation.changes[index], expectedVersion: operation.version }, operation.changeKeys[index])
        operation.target = result.entry; operation.version = result.entry.aggregateVersion; operation.changeNext += 1
      }
      if (keepOpen) {
        uploadSaved.current = true; savedVersion.current = operation.version
        if (!(workshop && !entry && separate)) savedTarget.current = operation.target
        operation.chosen.forEach((source) => baseline.current.set(sourceKey(source), source.id))
        continueUpload = chosen.some((source) => !baseline.current.has(sourceKey(source)))
        removed.current.clear(); promoted.current = null; attempt.current = null; setLocked(false)
      } else props.onSaved(operation.version, monthEntry)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const isConflict = reason instanceof ApiRequestError && reason.status === 409
      setConflict(isConflict)
      setError(isConflict ? 'Альбом уже изменили. Обновите данные перед новым сохранением.' : operation.metadataSaved ? 'Текст сохранён. Материалы пока не прикреплены. Повторите только прикрепление.' : operation.next ? `Сохранено работ: ${operation.next}. Остальные ещё не добавлены; повторим только их.` : 'Не удалось подтвердить сохранение. Повторите тот же запрос.')
      if (reason instanceof ApiRequestError && reason.status === 422 && !operation.metadataSaved && operation.next === 0) { attempt.current = null; setLocked(false); setError('Проверьте поля и дату. Работа должна содержать фото, событие — название и историю или материал.') }
      if (propagate) throw reason
    } finally { saving.current = false; setBusy(false) }
    if (continueUpload) await save(uploaded, propagate, keepOpen)
  }
  if (picker) return <SourcePicker accountId={accountId} api={api} initial={[]} onCancel={() => setPicker(false)} onChoose={choose} photosOnly={workshop} scopeKey={scopeKey} transport={transport} />
  return <section className="albums-editor">
    <header className="albums-toolbar"><button disabled={busy} onClick={props.onCancel} type="button">‹ Назад</button><h1>{entry?.kind === 'month' ? monthAgeLabel(entry.monthNumber!) : entry ? 'Изменить историю' : workshop ? 'Добавить работу' : 'Новая история'}</h1></header>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <fieldset disabled={busy || locked}>
        <label className="albums-field">{event ? 'Название события' : 'Название (необязательно)'}<input maxLength={240} onChange={(event) => setTitle(event.target.value)} required={event} value={title} /><small>{[...title].length}/120</small></label>
        <label className="albums-field">История<textarea onChange={(event) => setCaption(event.target.value)} rows={5} value={caption} /><small>{[...caption].length}/8000</small></label>
        <label className="albums-field">Когда это было<select onChange={(event) => { setPrecision(event.target.value as typeof precision); setValue('') }} value={precision}><option value="unknown">Не помню дату</option><option value="day">Точная дата</option><option value="month">Месяц</option><option value="year">Год</option></select></label>
        {precision !== 'unknown' ? <label className="albums-field">{precision === 'day' ? 'Дата' : precision === 'month' ? 'Месяц и год' : 'Год'}<input max={precision === 'year' ? '9999' : undefined} min={precision === 'year' ? '1' : undefined} onChange={(event) => setValue(event.target.value)} required type={precision === 'day' ? 'date' : precision === 'month' ? 'month' : 'number'} value={value} /></label> : null}
        {workshop ? <><label className="albums-field">Категория<select onChange={(event) => setCategory(event.target.value as typeof category)} value={category ?? 'other'}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="albums-field">Слова ребёнка<textarea onChange={(event) => setQuote(event.target.value)} rows={3} value={quote} /><small>{[...quote].length}/8000</small></label></> : null}
        {!month ? <><h2>Материалы · {entry?.collection ? Math.max(0, entry.sourceCount - removed.current.size) + sources.filter((source) => !baseline.current.has(sourceKey(source))).length : sources.length}</h2>
        <div className="albums-selected-sources">{sources.slice(sourcePage * 24, (sourcePage + 1) * 24).map((source, index) => <div key={sourceKey(source)}><SourcePreview accountId={accountId} scopeKey={scopeKey} source={source} transport={transport} /><button aria-label={`Убрать материал ${sourcePage * 24 + index + 1}`} onClick={() => removeSource(source)} type="button">Убрать</button>{sourcePage * 24 + index > 0 ? <button aria-label={`Сделать материал ${sourcePage * 24 + index + 1} главным`} onClick={() => { promoted.current = source; setSources([source, ...sources.filter((item) => sourceKey(item) !== sourceKey(source))]); setSourcePage(0) }} type="button">Главный</button> : <small>Главный</small>}</div>)}</div>
        {sourcePage > 0 ? <button onClick={() => setSourcePage(sourcePage - 1)} type="button">Предыдущие материалы</button> : null}
        {(sourcePage + 1) * 24 < sources.length ? <button onClick={() => setSourcePage(sourcePage + 1)} type="button">Следующие материалы</button> : sourceCursor ? <button disabled={sourceLoading} onClick={() => void loadSources(sourceCursor)} type="button">Ещё материалы</button> : null}
        {sourceLoading ? <p role="status">Загружаем материалы…</p> : null}
        {sourceError ? <p role="alert">Не удалось загрузить материалы. <button onClick={() => void loadSources(sourceCursor ?? undefined)} type="button">Повторить загрузку</button></p> : null}
        <button className="albums-secondary" onClick={() => setPicker(true)} type="button">Выбрать из воспоминаний</button>
        {props.canUpload ? <button className="albums-secondary" disabled={sourceLoading || sourceError} onClick={startUpload} type="button">Загрузить новое</button> : null}
        {workshop && !entry ? <label className="albums-checkbox"><input checked={separate} onChange={(event) => setSeparate(event.target.checked)} type="checkbox" />Каждое фото — отдельная работа. Снимите отметку для ракурсов одной работы.</label> : null}
        <p className="albums-muted">{dateLabel(date)} · Убирается только связь с альбомом, оригиналы сохраняются.</p></> : null}
      </fieldset>
      {completed ? <p role="status">Сохранено работ: {completed}</p> : null}
      {error ? <p className="albums-error" role="alert">{error}</p> : null}
      {conflict ? <button className="albums-secondary" disabled={busy} onClick={() => { setBusy(true); void Promise.all([api.album(album.id), entry ? api.entry(album.id, entry.id, month) : Promise.resolve(null)]).then(([fresh, detail]) => { savedVersion.current = fresh.album.version; if (detail) { setTitle(detail.entry.title ?? ''); setCaption(detail.entry.caption ?? ''); setSources([]); baseline.current.clear(); removed.current.clear(); promoted.current = null; savedTarget.current = detail.entry; setSourceCursor(null); void loadSources(); setQuote(detail.entry.childQuote ?? ''); setCategory(detail.entry.category); setPrecision(detail.entry.date.precision); setValue(detail.entry.date.value ?? '') } attempt.current = null; setConflict(false); setLocked(false); setError(null) }).catch(() => setError('Не удалось обновить данные. Повторите загрузку.')).finally(() => setBusy(false)) }} type="button">Обновить данные</button> : <button className="albums-primary" disabled={busy || sourceLoading || sourceError} type="submit">{busy ? 'Сохраняем…' : locked ? 'Повторить сохранение' : 'Сохранить'}</button>}
      <button disabled={busy} onClick={props.onCancel} type="button">Отмена</button>
    </form>
  </section>
}
