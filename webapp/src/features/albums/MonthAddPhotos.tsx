/* eslint-disable typographyPolicy/use-typography-component -- album form controls use the scoped albums stylesheet. */
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { AlbumEntryDto } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import type { AlbumsApi } from './api'
import { sourceRefs, type AlbumSource } from './model'
import { createMonthPhotoQueue } from './month-photo-queue'
import { uploadAlbumPhoto } from './album-photo-upload'
import { SourcePicker } from './SourcePicker'
import './month-photo-add.css'

type Props = {
  api: AlbumsApi
  albumId: string
  entry: AlbumEntryDto
  familyId: string
  accountId: string
  scopeKey: string
  transport: AuthenticatedTransport
  hostBridge: HostBridge
  active?: boolean
  onClose: () => void
  onChanged: () => void
}

type Queue = ReturnType<typeof createMonthPhotoQueue>
const errorsPerPage = 10
const phaseLabel = { reserve: 'Подготавливаем очередь', upload: 'Загружаем фото', attach: 'Добавляем в альбом' }

export function MonthAddPhotos(props: Props) {
  const { active = true, entry, accountId, familyId, scopeKey, albumId } = props
  const collection = entry.month ?? entry.collection
  if (!active || !collection || !entry.capabilities.edit) return null
  const { discussionGeneration, membershipEpoch } = collection
  return <MonthPhotoFlow key={JSON.stringify([accountId, familyId, scopeKey, albumId, entry.id, discussionGeneration, membershipEpoch])} {...props} discussionGeneration={discussionGeneration} membershipEpoch={membershipEpoch} />
}

function MonthPhotoFlow({ api, albumId, entry, familyId, accountId, scopeKey, transport, hostBridge, onClose, onChanged, discussionGeneration, membershipEpoch }: Props & { discussionGeneration: number; membershipEpoch: number }) {
  const [mode, setMode] = useState<'choose' | 'memories' | 'device'>('choose')
  const [queue, setQueue] = useState<Queue | null>(null)
  const [progress, setProgress] = useState<ReturnType<Queue['snapshot']> | null>(null)
  const [errorPage, setErrorPage] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)

  useLayoutEffect(() => () => {
    const running = request.current
    request.current = null
    running?.abort()
  }, [])

  function close() {
    const running = request.current
    request.current = null
    running?.abort()
    onClose()
    if (queue?.hasAttachmentAttempt()) onChanged()
  }

  function back() {
    if (!queue && mode !== 'choose') setMode('choose')
    else close()
  }
  const onNativeBack = useEffectEvent(back)
  useEffect(() => hostBridge.onBack(() => onNativeBack()), [hostBridge])

  function start(next: Queue) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    const notify = () => {
      if (request.current === controller) setProgress(next.snapshot())
    }
    setProgress(next.snapshot())
    void api.withMonthPhotoScope(controller.signal, (signal) => next.run({
      reserve: (count, key, requestSignal) => api.reserveMonthPhotoBatch(albumId, entry.id, { count, discussionGeneration, membershipEpoch }, key, requestSignal),
      upload: (file, key, resume, requestSignal, onProgress) => uploadAlbumPhoto(transport, familyId, file, key, resume, requestSignal, onProgress),
      attach: (item, key, requestSignal) => api.appendMonthPhoto(albumId, entry.id, item, key, requestSignal),
    }, signal, notify)).finally(() => {
      if (request.current === controller) request.current = null
    })
  }

  function prepare(selection: Parameters<typeof createMonthPhotoQueue>[0]) {
    if (!selection.length || request.current) return
    const next = createMonthPhotoQueue(selection)
    setQueue(next)
    setErrorPage(0)
    start(next)
  }

  function chooseMemories(sources: AlbumSource[]) {
    prepare(sourceRefs(sources.filter((source) => source.available && source.kind === 'photo')).map((source) => ({ source })))
  }

  if (!queue && mode === 'memories') {
    return <SourcePicker accountId={accountId} api={api} initial={[]} monthPhotos onCancel={back} onChoose={chooseMemories} scopeKey={scopeKey} transport={transport} />
  }

  const errorLastPage = Math.max(0, Math.ceil((progress?.failed ?? 0) / errorsPerPage) - 1)
  const currentErrorPage = Math.min(errorPage, errorLastPage)
  return <section aria-label="Добавление фотографий месяца" className="month-photo-add">
    <header className="albums-toolbar"><button onClick={back} type="button">‹ Назад</button><h1>Добавить фотографии</h1></header>
    <p className="albums-upload-notice">{entry.kind === 'month' ? 'Фотографии сохранятся в этом месяце альбома' : 'Фотографии сохранятся в этом альбоме'}</p>
    <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Выбрать фотографии с устройства" hidden multiple onChange={(event) => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      prepare(files.map((file) => ({ file })))
    }} ref={input} type="file" />

    {queue && progress ? <>
      <p aria-live="polite" role="status">Выбрано: {progress.total} · добавлено: {progress.saved}{progress.failed ? ` · с ошибкой: ${progress.failed}` : ''}</p>
      <progress aria-label="Ход добавления фотографий" max={progress.total} value={Math.min(progress.total, progress.saved + progress.failed + (progress.current?.fraction ?? 0))} />
      {progress.retryDelayMs !== null ? <p className="albums-muted" role="status">Сервер просит подождать. Очередь продолжится автоматически.</p> : progress.current ? <p className="albums-muted">{phaseLabel[progress.current.phase]} · {progress.current.name}</p> : null}
      {progress.stale ? <p className="albums-error" role="alert">Месяц или доступ изменился. Вернитесь к месяцу и проверьте добавленные фотографии.</p> : null}
      {progress.queueError ? <p className="albums-error" role="alert">{progress.queueError}</p> : null}
      {!progress.running && progress.pending > 0 && !progress.stale && !progress.queueError ? <p role="status">Очередь остановлена. Добавленные фотографии сохранены.</p> : null}
      {progress.failed ? <div className="albums-error">
        <h2>Фотографии с ошибками</h2>
        <ul>{progress.errors.slice(currentErrorPage * errorsPerPage, (currentErrorPage + 1) * errorsPerPage).map((error) => (
          <li key={error.key}><strong>{error.name}</strong><br />{error.message}</li>
        ))}</ul>
        {currentErrorPage > 0 ? <button onClick={() => setErrorPage(currentErrorPage - 1)} type="button">Предыдущие ошибки</button> : null}
        {currentErrorPage < errorLastPage ? <button onClick={() => setErrorPage(currentErrorPage + 1)} type="button">Следующие ошибки</button> : null}
      </div> : null}
      {mode === 'device' && (progress.pending > 0 || progress.retryable) ? <p className="albums-muted">Если закрыть приложение, незавершённые файлы нужно будет выбрать снова. Добавленные фотографии останутся в месяце.</p> : null}
      <footer className="albums-form-actions">
        {progress.running ? <button className="albums-secondary" onClick={() => request.current?.abort()} type="button">Остановить</button> : <>
          {!progress.stale && (progress.pending || progress.retryable) ? <button className="albums-primary" onClick={() => start(queue)} type="button">{progress.retryable ? 'Повторить неуспешные' : 'Продолжить'}</button> : null}
          <button className="albums-secondary" onClick={close} type="button">{entry.kind === 'month' ? 'Вернуться к месяцу' : 'Вернуться к альбому'}</button>
        </>}
      </footer>
    </> : mode === 'device' ? <>
      <p className="albums-muted">Здесь можно добавлять только фотографии.</p>
      <button className="albums-primary" onClick={() => input.current?.click()} type="button">Выбрать файлы</button>
    </> : <>
      <button className="albums-primary" onClick={() => setMode('memories')} type="button">Из воспоминаний</button>
      <button className="albums-secondary" onClick={() => { setMode('device'); input.current?.click() }} type="button">С устройства</button>
    </>}
  </section>
}
