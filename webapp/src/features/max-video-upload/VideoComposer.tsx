import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import type { AuthenticatedTransport } from '@/platform/api'
import { finalizeMaxVideo, reserveMaxVideo, validateVideoFile, type MaxVideoReservation } from './api'
import { uploadVideoToMax } from './xhr-upload'

export type VideoComposerProps = {
  childId: string
  familyId: string
  onCancel: () => void
  onSuccess: () => void | Promise<void>
  transport: AuthenticatedTransport
}

type Capability = Pick<MaxVideoReservation, 'sessionId' | 'uploadUrl' | 'uploadToken'>

export function VideoComposer({ childId, familyId, onCancel, onSuccess, transport }: VideoComposerProps) {
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [capability, setCapability] = useState<Capability | null>(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'reserving' | 'uploading' | 'saving' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
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
    setProgress(0)
  }

  const clearSelectedFile = () => {
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const chooseFile = (next: File | null) => {
    setError(null)
    setCapability(null)
    setProgress(0)
    if (!next) {
      clearSelectedFile()
      return
    }
    const validation = validateVideoFile(next)
    if (!validation.ok) {
      clearSelectedFile()
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
    const selected = file
    if (!selected) {
      setError('Выберите видео.')
      setStatus('error')
      saving.current = false
      return
    }
    if (!caption.trim()) {
      setError('Добавьте подпись.')
      setStatus('error')
      saving.current = false
      return
    }
    const validation = validateVideoFile(selected)
    if (!validation.ok) {
      setError(validation.code === 'too_large' ? 'Видео больше 250 МБ.' : 'Поддерживаются MP4, MOV, MKV и WebM.')
      setStatus('error')
      saving.current = false
      return
    }

    setIsSaving(true)
    const controller = new AbortController()
    abortController.current = controller
    try {
      // Every explicit save/retry obtains a fresh provider capability; an old URL/token is
      // never reused after a retryable finalize response.
      if (capability) setCapability(null)
      setStatus('reserving')
      const reservation = await reserveMaxVideo(transport, familyId, {
        childId,
        body: caption,
        occurredAt: new Date(`${occurredAt}T12:00:00.000Z`).toISOString(),
        file: selected,
      }, controller.signal)
      if (!reservation.uploadUrl || !reservation.uploadToken) throw new Error('Не удалось подготовить загрузку видео')
      setCapability({ sessionId: reservation.sessionId, uploadUrl: reservation.uploadUrl, uploadToken: reservation.uploadToken })
      setStatus('uploading')
      await uploadVideoToMax(reservation.uploadUrl, selected, controller.signal, (loaded, total) => {
        setProgress(total > 0 ? Math.round((loaded / total) * 100) : 0)
      })
      setStatus('saving')
      const result = await finalizeMaxVideo(transport, familyId, reservation.sessionId, reservation.uploadToken, controller.signal)
      if (result.state !== 'finalized') {
        setCapability(null)
        clearSelectedFile()
        setProgress(0)
        setStatus('error')
        setError(result.state === 'processing' ? 'Видео ещё обрабатывается. Повторите попытку.' : 'Не удалось сохранить видео. Попробуйте ещё раз.')
        return
      }
      setCapability(null)
      clearSelectedFile()
      setProgress(100)
      setStatus('success')
      // Finalization is already durable. A feed refresh failure must not turn a saved memory
      // into a misleading upload error or trigger a second provider send.
      try { await onSuccess() } catch { /* the next normal feed refresh can recover */ }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setCapability(null)
      clearSelectedFile()
      setProgress(0)
      setStatus('error')
      setError('Не удалось сохранить видео. Попробуйте ещё раз.')
    } finally {
      if (abortController.current === controller) abortController.current = null
      saving.current = false
      setIsSaving(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)] px-4 py-6">
      <section aria-labelledby="max-video-title" className="rounded-[var(--radius-card)] bg-card p-5 shadow-[var(--shadow-card)]">
        <Typography id="max-video-title" variant="memoryScreen">Загрузить видео</Typography>
        <Typography className="mt-2" tone="muted" variant="memoryBody">Видео будет сохранено в семейную ленту.</Typography>
        <label className="mt-6 block" htmlFor="max-video-file"><Typography variant="memoryButton">Видео</Typography></label>
        <input accept=".mp4,.mov,.mkv,.webm,video/mp4,video/quicktime,video/x-matroska,video/webm" className="mt-2 block w-full" id="max-video-file" onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} ref={fileInput} type="file" />
        <label className="mt-5 block" htmlFor="max-video-caption"><Typography variant="memoryButton">Подпись</Typography></label>
        <textarea aria-label="Подпись к видео" className="mt-2 min-h-24 w-full rounded-[var(--radius-field)] border bg-muted p-3" id="max-video-caption" onChange={(event) => setCaption(event.currentTarget.value)} placeholder="Добавьте подпись" value={caption} />
        <label className="mt-5 block" htmlFor="max-video-date"><Typography variant="memoryButton">Дата</Typography></label>
        <input aria-label="Дата видео" className="mt-2 w-full rounded-[var(--radius-field)] border bg-muted p-3" id="max-video-date" onChange={(event) => setOccurredAt(event.currentTarget.value)} type="date" value={occurredAt} />
        {status === 'uploading' ? <Typography className="mt-4" aria-live="polite" variant="memoryMeta">Загружаем файл… {progress}%</Typography> : null}
        {status === 'saving' || status === 'reserving' ? <Typography className="mt-4" aria-live="polite" variant="memoryMeta">Сохраняем файл…</Typography> : null}
        {status === 'success' ? <Typography className="mt-4" aria-live="polite" variant="memoryMeta">Сохранено в семейную ленту</Typography> : null}
        {error ? <Typography className="mt-4 text-destructive" role="alert" variant="memoryMeta">{error}</Typography> : null}
        <div className="mt-6 flex gap-3">
          <Button className="min-h-12 flex-1" disabled={isSaving || status === 'reserving' || status === 'uploading' || status === 'saving'} onClick={() => void save()} type="button">Сохранить</Button>
          <Button className="min-h-12" disabled={isSaving && status !== 'uploading'} onClick={() => { clearEphemeral(); onCancel() }} type="button" variant="outline">Отмена</Button>
        </div>
      </section>
    </main>
  )
}
