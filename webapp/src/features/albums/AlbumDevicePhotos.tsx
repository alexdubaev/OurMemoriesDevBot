/* eslint-disable typographyPolicy/use-typography-component -- native album upload progress uses its scoped stylesheet. */
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { WebpIcon } from '@/components/WebpIcon'
import type { AuthenticatedTransport } from '@/platform/api'
import { uploadAlbumPhoto } from './album-photo-upload'
import { createMonthPhotoQueue } from './month-photo-queue'
import './month-photo-add.css'

type Queue = ReturnType<typeof createMonthPhotoQueue>
type Props = {
  active: boolean; familyId: string; transport: AuthenticatedTransport
  attach: (mediaIds: string[], batchId: string) => Promise<void>; complete: (batchId: string, signal: AbortSignal) => Promise<unknown>; onClose: () => void
  onCancelRequestChange: (cancel: () => void) => void
}

export function AlbumDevicePhotos({ active, familyId, transport, attach, complete, onClose, onCancelRequestChange }: Props) {
  const inputId = useId()
  const [queue, setQueue] = useState<Queue | null>(null)
  const [progress, setProgress] = useState<ReturnType<Queue['snapshot']> | null>(null)
  const [errorPage, setErrorPage] = useState(0)
  const request = useRef<AbortController | null>(null)
  const running = useRef<Promise<void> | null>(null)
  const closing = useRef(false)
  const close = () => {
    if (closing.current) return
    closing.current = true
    request.current?.abort()
    if (running.current) void running.current.finally(onClose)
    else onClose()
  }
  const cancel = useEffectEvent(close)
  useEffect(() => { onCancelRequestChange(() => cancel()) }, [onCancelRequestChange])
  useLayoutEffect(() => () => { request.current?.abort(); request.current = null }, [])
  useEffect(() => { if (!active) request.current?.abort() }, [active])
  function start(next: Queue) {
    if (request.current || !active) return
    const controller = new AbortController()
    request.current = controller
    const notify = () => { if (request.current === controller) setProgress(next.snapshot()) }
    setProgress(next.snapshot())
    running.current = next.run({
      upload: (file, key, resume, signal, onProgress) => uploadAlbumPhoto(transport, familyId, file, key, resume, signal, onProgress),
      attachPhoto: async (source, _key, signal, batchId) => { signal.throwIfAborted(); await attach([source.sourceId], batchId) },
      complete,
    }, controller.signal, notify).finally(() => { if (request.current === controller) request.current = null })
  }
  const errorCount = progress?.failed ?? 0
  const page = Math.min(errorPage, Math.max(0, Math.ceil(errorCount / 10) - 1))
  return <section aria-label="Добавление фотографий альбома" className="month-photo-add album-device-photos">
    <header className="albums-toolbar"><button onClick={close} type="button">‹ Назад</button><h1>Добавить фотографии</h1></header>
    <p className="albums-upload-notice">Фотографии сохранятся в этом альбоме</p>
    {!queue ? <>
      <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Выбрать фотографии с устройства" className="memoly-add-native-file" id={inputId} multiple onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        if (!files.length) return
        const next = createMonthPhotoQueue(files.map((file) => ({ file })))
        setQueue(next); start(next)
      }} type="file" />
      <label className="memoly-add-photo-picker" htmlFor={inputId}>
        <span className="memoly-add-picker-icon"><WebpIcon decorative name="photo" size={34} /></span>
        <strong>Выберите фотографии</strong>
        <span>Нажмите, чтобы выбрать фотографии<br />с устройства</span>
      </label>
    </> : progress ? <>
      <p aria-live="polite" role="status">Выбрано: {progress.total} · добавлено: {progress.saved}{progress.failed ? ` · с ошибкой: ${progress.failed}` : ''}</p>
      <progress aria-label="Ход добавления фотографий" max={progress.total} value={Math.min(progress.total, progress.saved + progress.failed + (progress.current?.fraction ?? 0))} />
      {progress.current ? <p>{progress.current.name}</p> : null}
      {progress.retryDelayMs !== null ? <p role="status">Сервер просит подождать. Очередь продолжится автоматически.</p> : null}
      {progress.stale ? <p role="alert">Альбом или доступ изменился. Вернитесь к альбому и проверьте добавленные фотографии.</p> : null}
      {progress.queueError ? <p role="alert">{progress.queueError}</p> : null}
      {progress.completionPending && !progress.running ? <button onClick={() => start(queue)} type="button">Повторить завершение</button> : null}
      {progress.failed ? <div className="albums-error"><h2>Фотографии с ошибками</h2><ul>{progress.errors.slice(page * 10, (page + 1) * 10).map((error) => <li key={error.key}><strong>{error.name}</strong><br />{error.message}</li>)}</ul>
        {page > 0 ? <button onClick={() => setErrorPage(page - 1)} type="button">Предыдущие ошибки</button> : null}
        {(page + 1) * 10 < errorCount ? <button onClick={() => setErrorPage(page + 1)} type="button">Следующие ошибки</button> : null}
      </div> : null}
      {progress.pending || progress.retryable ? <p>Если закрыть приложение, незавершённые файлы нужно будет выбрать снова. Добавленные фотографии сохранятся.</p> : null}
      <footer className="albums-form-actions">
        {progress.running ? <button onClick={() => request.current?.abort()} type="button">Остановить</button> : <>
          {!progress.stale && (progress.pending || progress.retryable) ? <button onClick={() => start(queue)} type="button">{progress.retryable ? 'Повторить неуспешные' : 'Продолжить'}</button> : null}
          <button onClick={close} type="button">Вернуться к альбому</button>
        </>}
      </footer>
    </> : null}
  </section>
}
