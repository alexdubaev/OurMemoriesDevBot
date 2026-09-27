import { useEffect, useRef, useState } from 'react'
import { ZodError } from 'zod'

import { Button } from '@/components/ui/button'
import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { familyCalendarDate } from '@/features/family'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { finalizeMaxVideo, reserveMaxVideo, validateVideoFile, type MaxVideoReservation } from './api'
import { reservationOccurredAt } from './date'
import { uploadVideoToMax } from './xhr-upload'
import '@/styles/composer-skin.css'

export type VideoComposerProps = {
  childId: string
  familyId: string
  familyTimezone: string
  onCancel: () => void
  onSuccess: () => void | Promise<void>
  transport: AuthenticatedTransport
}

type Capability = Pick<MaxVideoReservation, 'sessionId' | 'uploadUrl' | 'uploadToken'>
type SaveStage = 'reserve' | 'upload' | 'finalize'
type ReserveErrorCode = 'reserve_not_sent' | 'reserve_network_error' | `reserve_http_${number}` | 'reserve_parse_error'

function classifyReserveError(reason: unknown): ReserveErrorCode {
  if (reason instanceof ApiRequestError) return `reserve_http_${reason.status}`
  if (reason instanceof ZodError || reason instanceof SyntaxError) return 'reserve_parse_error'
  return 'reserve_network_error'
}

function safeReserveApplicationCode(reason: unknown): string | null {
  if (!(reason instanceof ApiRequestError) || !/^[A-Z0-9_]+$/.test(reason.code)) return null
  return reason.code.toLowerCase()
}

export function VideoComposer({ childId, familyId, familyTimezone, onCancel, onSuccess, transport }: VideoComposerProps) {
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => familyCalendarDate(familyTimezone))
  const maximumOccurredAt = familyCalendarDate(familyTimezone)
  const [capability, setCapability] = useState<Capability | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'reserving' | 'uploading' | 'saving' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [errorStage, setErrorStage] = useState<SaveStage | null>(null)
  const [invalidFile, setInvalidFile] = useState(false)
  const [validationError, setValidationError] = useState(false)
  const [reserveErrorCode, setReserveErrorCode] = useState<ReserveErrorCode | null>(null)
  const [reserveApplicationCode, setReserveApplicationCode] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const saving = useRef(false)
  const abortController = useRef<AbortController | null>(null)

  useEffect(() => () => {
    abortController.current?.abort()
    abortController.current = null
  }, [])

  const clearEphemeral = () => {
    abortController.current?.abort()
    abortController.current = null
    setCapability(null)
    clearSelectedFile()
    setProgress(null)
  }

  const clearSelectedFile = () => {
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const chooseFile = (next: File | null) => {
    if (saving.current) return
    setError(null)
    setErrorStage(null)
    setInvalidFile(false)
    setValidationError(false)
    setReserveErrorCode(null)
    setReserveApplicationCode(null)
    setCapability(null)
    setProgress(null)
    if (!next) {
      clearSelectedFile()
      return
    }
    const validation = validateVideoFile(next)
    if (!validation.ok) {
      clearSelectedFile()
      setInvalidFile(true)
      setError(validation.code === 'too_large' ? 'Видео больше 250 МБ.' : 'Поддерживаются MP4, MOV, MKV и WebM.')
      setStatus('error')
      return
    }
    setFile(next)
    setStatus('idle')
  }

  const save = async () => {
    if (saving.current) return
    saving.current = true
    setError(null)
    setErrorStage(null)
    setInvalidFile(false)
    setValidationError(false)
    setReserveErrorCode(null)
    setReserveApplicationCode(null)
    const selected = file
    const pendingFinalize: Capability | null = capability?.sessionId && capability.uploadToken
      ? capability
      : null
    if (!selected && !pendingFinalize) {
      setValidationError(true)
      setError('Выберите видео.')
      setStatus('error')
      saving.current = false
      return
    }
    if (!pendingFinalize && !caption.trim()) {
      setValidationError(true)
      setError('Добавьте подпись.')
      setStatus('error')
      saving.current = false
      return
    }
    if (selected) {
      const validation = validateVideoFile(selected)
      if (!validation.ok) {
        setValidationError(true)
        setError(validation.code === 'too_large' ? 'Видео больше 250 МБ.' : 'Поддерживаются MP4, MOV, MKV и WebM.')
        setStatus('error')
        saving.current = false
        return
      }
    }

    const occurredAtValue = reservationOccurredAt(occurredAt, familyTimezone)
    if (!occurredAtValue) {
      setValidationError(true)
      setError('Дата видео не может быть в будущем.')
      setStatus('error')
      saving.current = false
      return
    }

    setIsSaving(true)
    const controller = new AbortController()
    abortController.current = controller
    let finalizeCapability = pendingFinalize
    let uploadCompleted = Boolean(pendingFinalize)
    try {
      if (!finalizeCapability) {
        // A fresh save starts a new durable operation. A retry after provider processing keeps
        // the existing session below and never sends the same video to MAX twice.
        if (!selected) throw new Error('Выберите видео.')
        setStatus('reserving')
        const reservation = await reserveMaxVideo(transport, familyId, {
          childId,
          body: caption,
          occurredAt: occurredAtValue,
          file: selected,
        }, controller.signal)
        if (!reservation.uploadUrl || !reservation.uploadToken) throw new Error('Не удалось подготовить загрузку видео')
        finalizeCapability = { sessionId: reservation.sessionId, uploadUrl: reservation.uploadUrl, uploadToken: reservation.uploadToken }
        setCapability(finalizeCapability)
        setStatus('uploading')
        await uploadVideoToMax(reservation.uploadUrl, selected, controller.signal, (loaded, total) => {
          setProgress(total > 0 ? Math.round((loaded / total) * 100) : null)
        })
        uploadCompleted = true
        // The provider URL is no longer needed after the direct upload. Keep only the opaque
        // token required by the authenticated finalize endpoint for safe retry recovery.
        setCapability({ sessionId: reservation.sessionId, uploadToken: reservation.uploadToken })
      }
      if (!finalizeCapability?.uploadToken) throw new Error('Не удалось подготовить загрузку видео')
      setStatus('saving')
      const result = await finalizeMaxVideo(transport, familyId, finalizeCapability.sessionId, finalizeCapability.uploadToken, controller.signal)
      if (result.state !== 'finalized') {
        if (result.state === 'expired' || result.state === 'failed') setCapability(null)
        setProgress(null)
        setStatus('error')
        setErrorStage('finalize')
        setError(result.state === 'processing' ? 'Видео ещё обрабатывается. Повторите попытку.' : 'Не удалось сохранить видео. Попробуйте ещё раз.')
        return
      }
      setCapability(null)
      clearSelectedFile()
      setStatus('success')
    } catch (reason) {
      // An abort caused by Cancel/unmount is intentional. A provider-side XHR abort is
      // not: treating every AbortError as intentional would leave the composer stuck in
      // `uploading` with the Save button disabled and no retryable error.
      if (reason instanceof DOMException && reason.name === 'AbortError' && controller.signal.aborted) return
      const expired = reason instanceof ApiRequestError && reason.code === 'UPLOAD_EXPIRED'
      if (uploadCompleted && finalizeCapability && !expired) {
        // The request may have reached the backend after the browser lost its response. Keep
        // only the session/token needed to recover the same durable finalize operation.
        setCapability({ sessionId: finalizeCapability.sessionId, uploadToken: finalizeCapability.uploadToken })
      } else {
        setCapability(null)
      }
      setProgress(null)
      setStatus('error')
      const stage: SaveStage = uploadCompleted ? 'finalize' : finalizeCapability ? 'upload' : 'reserve'
      setErrorStage(stage)
      if (stage === 'reserve') {
        setReserveErrorCode(classifyReserveError(reason))
        setReserveApplicationCode(safeReserveApplicationCode(reason))
      }
      setError(stage === 'reserve'
        ? 'Не удалось подготовить сохранение видео. Попробуйте ещё раз.'
        : stage === 'upload'
          ? 'Не удалось загрузить видео. Попробуйте ещё раз.'
          : 'Не удалось завершить сохранение видео. Попробуйте ещё раз.')
    } finally {
      if (abortController.current === controller) abortController.current = null
      saving.current = false
      setIsSaving(false)
    }
  }

  const busy = isSaving || status === 'reserving' || status === 'uploading' || status === 'saving'
  const returnToFeed = () => {
    const unsaved = status !== 'success' && (file !== null || caption.trim() !== '' || occurredAt !== maximumOccurredAt || capability !== null)
    if (unsaved && typeof window.confirm === 'function' && !window.confirm('Удалить несохранённые изменения?')) return
    clearEphemeral()
    onCancel()
  }
  return <main className="memoly-video-v2" data-video-state={invalidFile ? 'invalid' : status}>
    <div className="memoly-video-v2-shell">
      {status !== 'success' ? <header className="memoly-video-v2-topbar">
        <button aria-label="Назад" className="memoly-add-back" disabled={busy && status !== 'uploading'} onClick={returnToFeed} type="button"><WebpIcon decorative name="chevron" size={22} /></button>
        <Typography as="h1" variant="memoryScreen">Загрузить видео</Typography>
        <span aria-hidden="true" />
      </header> : null}

      {status === 'success' ? <section aria-label="Видео сохранено" className="memoly-video-v2-success" role="status">
        <Typography aria-hidden="true" as="span" className="memoly-video-v2-success-mark" variant="memoryScreen">✓</Typography>
        <Typography as="h1" variant="memoryScreen">Сохранено в семейную ленту</Typography>
        <Typography as="p" variant="memoryBody">Видео появится в ленте после обработки.</Typography>
        <div className="memoly-video-v2-success-actions">
          <Button onClick={() => void onSuccess()} type="button">Перейти в ленту</Button>
        </div>
      </section> : <>
        <section aria-label="Данные видео" className="memoly-video-v2-form-card">
          <label className="memoly-video-v2-file-tile" htmlFor="max-video-file">
            <span aria-hidden="true" className="memoly-video-v2-file-icon"><WebpIcon decorative name="video" size={22} /></span>
            <span><Typography as="strong" variant="memoryBodyMedium">{file?.name ?? 'Видео'}</Typography><Typography as="small" variant="memoryMeta">{file ? `${formatFileSize(file.size)} · Выбрать другое видео` : 'MP4, MOV, MKV или WebM · до 250 МБ'}</Typography></span>
            <WebpIcon decorative name="chevron" size={18} />
          </label>
          <input accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm" className="memoly-video-v2-native-file" disabled={busy} id="max-video-file" onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} ref={fileInput} type="file" />
          {file && status === 'idle' ? <VideoFilePreview file={file} /> : null}
          <label className="memoly-video-v2-label" htmlFor="max-video-caption"><Typography as="span" variant="memoryButton">Подпись</Typography><Typography as="span" variant="memoryMeta">обязательно для MAX</Typography></label>
          <textarea aria-label="Подпись к видео" className="memoly-video-v2-field memoly-video-v2-textarea" disabled={busy || Boolean(capability)} id="max-video-caption" onChange={(event) => setCaption(event.currentTarget.value)} placeholder="Добавьте подпись" value={caption} />
          <label className="memoly-video-v2-label" htmlFor="max-video-date"><Typography as="span" variant="memoryButton">Дата</Typography></label>
          <input aria-label="Дата видео" className="memoly-video-v2-field" disabled={busy || Boolean(capability)} id="max-video-date" max={maximumOccurredAt} onChange={(event) => setOccurredAt(event.currentTarget.value)} type="date" value={occurredAt} />
        </section>

        {status === 'uploading' ? <section aria-label="Загрузка видео" className="memoly-video-v2-progress" role="status"><div><Typography as="strong" variant="memoryBodyMedium">Загружаем файл…</Typography><Typography aria-live="polite" as="span" variant="memoryMeta">{progress === null ? 'Идёт загрузка' : `${progress}%`}</Typography></div><ProgressBar value={progress} label="Загрузка видео" /></section> : null}
        {status === 'reserving' || status === 'saving' ? <section aria-label="Сохранение видео" className="memoly-video-v2-progress" role="status"><Typography as="strong" variant="memoryBodyMedium">{status === 'reserving' ? 'Подготавливаем загрузку…' : 'Завершаем сохранение…'}</Typography><ProgressBar value={null} label="Сохранение видео" /></section> : null}
        {error ? <section className={errorStage === 'finalize' && capability ? 'memoly-video-v2-message is-warning' : 'memoly-video-v2-message is-error'} data-save-error-code={reserveErrorCode ?? undefined} data-save-stage={errorStage ?? undefined} role="alert"><Typography as="strong" variant="memoryBodyMedium">{invalidFile ? 'Файл не подходит' : validationError ? 'Проверьте данные видео' : errorStage === 'finalize' && capability ? 'Видео ещё обрабатывается' : 'Не удалось сохранить видео'}</Typography><Typography as="span" variant="memoryMeta">{error}</Typography>{reserveErrorCode ? <Typography as="small" data-save-error-code={reserveErrorCode} variant="memoryMeta">Код: {reserveErrorCode}{reserveApplicationCode ? ` / ${reserveApplicationCode}` : ''}</Typography> : null}</section> : null}
        {invalidFile ? <Button className="memoly-video-v2-action" onClick={() => fileInput.current?.click()} type="button">Выбрать другое видео</Button> : !busy ? <Button className="memoly-video-v2-action" onClick={() => void save()} type="button">{status === 'error' && capability ? 'Повторить попытку' : status === 'error' ? 'Повторить' : 'Сохранить'}</Button> : null}
        <Button className="memoly-video-v2-action secondary" disabled={busy && status !== 'uploading'} onClick={returnToFeed} type="button" variant="outline">Отмена</Button>
      </>}
    </div>
  </main>
}

function ProgressBar({ label, value }: { label: string; value: number | null }) {
  return <div aria-label={label} aria-valuemax={value === null ? undefined : 100} aria-valuemin={value === null ? undefined : 0} aria-valuenow={value ?? undefined} className="memoly-composer-progress" role="progressbar"><span className={value === null ? 'memoly-composer-progress-indeterminate' : undefined} style={value === null ? undefined : { width: `${value}%` }} /></div>
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} КБ`
  return `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`
}

function VideoFilePreview({ file }: { file: File }) {
  const [source, setSource] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const url = URL.createObjectURL(file)
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) setSource(url) })
    return () => { cancelled = true; URL.revokeObjectURL(url) }
  }, [file])
  return <div className="memoly-video-v2-preview">{source ? <video aria-label="Предпросмотр выбранного видео" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} playsInline preload="metadata" src={source} /> : <WebpIcon decorative name="video" size={40} />}{duration !== null && Number.isFinite(duration) ? <Typography as="span" variant="memoryMeta">{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}</Typography> : null}</div>
}
