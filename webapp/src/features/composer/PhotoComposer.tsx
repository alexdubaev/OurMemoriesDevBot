import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { familyCalendarDate, uploadFamilyPhoto } from '@/features/family'
import { ApiRequestError } from '@/platform/api'
import type { AuthenticatedTransport } from '@/platform/api'
import {
  createPhotoIdempotencyKey,
  createPhotoMemory,
  resolvePhotoContentType,
  validatePhotoFiles,
} from './api'
import { composerOccurredAt } from './date'
import '@/styles/composer-skin.css'

export type PhotoComposerProps = {
  childId: string
  familyId: string
  familyTimezone: string
  transport: AuthenticatedTransport
  onCancel: () => void
  onSuccess: () => void | Promise<void>
}

type SaveStage = 'reserve' | 'upload' | 'finalize' | 'create'

function safeFinalizeApplicationCode(reason: unknown): string | null {
  if (!(reason instanceof ApiRequestError) || !/^PHOTO_FINALIZE_[A-Z_]+$/.test(reason.code)) return null
  return reason.code.toLowerCase()
}

export function PhotoComposer({ childId, familyId, familyTimezone, transport, onCancel, onSuccess }: PhotoComposerProps) {
  const [files, setFiles] = useState<File[]>([])
  const [caption, setCaption] = useState('')
  const [occurredDate, setOccurredDate] = useState(() => familyCalendarDate(familyTimezone))
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [errorStage, setErrorStage] = useState<SaveStage | null>(null)
  const [finalizeApplicationCode, setFinalizeApplicationCode] = useState<string | null>(null)
  const completedAssets = useRef<Array<string | null>>([])
  const idempotencyKey = useRef<string | null>(null)
  const saving = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => abortController.current?.abort(), [])

  function chooseFiles(next: File[]) {
    if (saving.current) return
    const validation = validatePhotoFiles(next)
    if (!validation.ok) {
      setError(validation.code === 'too_many' ? 'Выберите от 1 до 10 фотографий.' : 'Поддерживаются JPG, PNG, WebP и HEIC.')
      setErrorStage(null)
      setStatus('error')
      return
    }
    setFiles(next)
    completedAssets.current = next.map(() => null)
    idempotencyKey.current = null
    setProgress(0)
    setError(null)
    setErrorStage(null)
    setFinalizeApplicationCode(null)
    setStatus('idle')
  }

  function removeFile(index: number) {
    if (saving.current) return
    const next = files.filter((_, current) => current !== index)
    setFiles(next)
    completedAssets.current = next.map(() => null)
    idempotencyKey.current = null
    setProgress(0)
    setError(null)
    setStatus(next.length ? 'idle' : 'idle')
    if (fileInput.current) fileInput.current.value = ''
  }

  async function save() {
    if (saving.current) return
    if (!files.length) {
      setError('Выберите хотя бы одну фотографию.')
      setStatus('error')
      return
    }
    const occurredAt = composerOccurredAt(occurredDate, familyTimezone)
    if (!occurredAt) {
      setError('Дата воспоминания не может быть в будущем.')
      setStatus('error')
      return
    }

    saving.current = true
    setStatus('saving')
    setError(null)
    setErrorStage(null)
    const controller = new AbortController()
    abortController.current = controller
    const key = idempotencyKey.current ?? createPhotoIdempotencyKey()
    idempotencyKey.current = key

    const saveStage: { current: SaveStage } = { current: 'reserve' }
    try {
      const mediaIds: string[] = []
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        if (!file) continue
        let assetId = completedAssets.current[index]
        if (!assetId) {
          const contentType = resolvePhotoContentType(file)
          if (!contentType) throw new Error('Поддерживаются JPG, PNG, WebP и HEIC.')
          assetId = await uploadFamilyPhoto(transport, familyId, file, contentType, 'memory', controller.signal, (nextStage) => {
            saveStage.current = nextStage
            setErrorStage(nextStage)
          })
          completedAssets.current[index] = assetId
        }
        mediaIds.push(assetId)
        setProgress(Math.round(((index + 1) / files.length) * 100))
      }

      saveStage.current = 'create'
      setErrorStage(saveStage.current)
      await createPhotoMemory(transport, familyId, {
        childId,
        body: caption.trim(),
        occurredAt,
        mediaIds,
        idempotencyKey: key,
      }, controller.signal)
      setStatus('success')
      setProgress(100)
      try { await onSuccess() } catch { /* the memory is already durable */ }
    } catch (reason) {
      if (controller.signal.aborted) return
      setErrorStage(saveStage.current)
      setProgress(0)
      setStatus('error')
      if (saveStage.current === 'finalize') setFinalizeApplicationCode(safeFinalizeApplicationCode(reason))
      setError(saveStage.current === 'reserve'
        ? 'Не удалось подготовить сохранение фотографий. Попробуйте ещё раз.'
        : saveStage.current === 'upload'
          ? 'Не удалось загрузить фотографию. Попробуйте ещё раз.'
          : saveStage.current === 'finalize'
            ? 'Не удалось подтвердить фотографию. Попробуйте ещё раз.'
            : 'Не удалось сохранить воспоминание. Попробуйте ещё раз.')
    } finally {
      if (abortController.current === controller) abortController.current = null
      saving.current = false
    }
  }

  function cancel() {
    const initialDate = familyCalendarDate(familyTimezone)
    const dirty = status !== 'success' && (files.length > 0 || caption.length > 0 || occurredDate !== initialDate)
    if (dirty && typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('Удалить несохранённые изменения?')) return
    abortController.current?.abort()
    abortController.current = null
    saving.current = false
    onCancel()
  }

  return (
    <main className="memoly-composer-page mx-auto min-h-screen min-h-dvh max-w-[var(--layout-max-width)]">
      <section aria-labelledby="photo-composer-title" className="memoly-composer-card rounded-[var(--radius-card)] p-5">
        <Typography id="photo-composer-title" variant="memoryScreen">Добавить фотографии</Typography>
        <Typography className="mt-2" tone="muted" variant="memoryBody">Выберите от 1 до 10 фотографий для одного воспоминания.</Typography>
        <label className="memoly-composer-label mt-6 block" htmlFor="photo-composer-files"><Typography variant="memoryButton">Фотографии</Typography></label>
        <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="memoly-composer-file-input mt-2 block w-full" disabled={status === 'saving'} id="photo-composer-files" multiple onChange={(event) => chooseFiles(Array.from(event.currentTarget.files ?? []))} ref={fileInput} type="file" />
        {files.length ? <div aria-label="Предпросмотр фотографий" className="mt-4 grid grid-cols-3 gap-2">{files.map((file, index) => <PhotoPreview file={file} index={index} key={`${file.name}-${index}`} onRemove={removeFile} />)}</div> : null}
        <label className="memoly-composer-label mt-5 block" htmlFor="photo-composer-caption"><Typography variant="memoryButton">Подпись</Typography></label>
        <textarea aria-label="Подпись к фотографиям" className="memoly-composer-field memoly-composer-textarea mt-2 w-full rounded-[var(--radius-field)] p-3" id="photo-composer-caption" onChange={(event) => setCaption(event.currentTarget.value)} placeholder="Добавьте подпись" value={caption} />
        <label className="memoly-composer-label mt-5 block" htmlFor="photo-composer-date"><Typography variant="memoryButton">Дата</Typography></label>
        <input aria-label="Дата фотографий" className="memoly-composer-field memoly-composer-date mt-2 w-full rounded-[var(--radius-field)] p-3" id="photo-composer-date" max={familyCalendarDate(familyTimezone)} onChange={(event) => setOccurredDate(event.currentTarget.value)} type="date" value={occurredDate} />
        {status === 'saving' ? <div className="memoly-composer-status mt-4" role="status"><Typography aria-live="polite" variant="memoryMeta">Сохраняем фотографии… {progress}%</Typography><ProgressBar value={progress} label="Загрузка фотографий" /></div> : null}
        {status === 'success' ? <><Typography aria-live="polite" className="memoly-composer-status mt-4" variant="memoryMeta">Сохранено в семейную ленту</Typography><ProgressBar value={100} label="Фотографии сохранены" /></> : null}
        {error ? <>
          <Typography className="mt-4 text-destructive" data-save-stage={errorStage ?? undefined} role="alert" variant="memoryMeta">{error}</Typography>
          {finalizeApplicationCode ? <Typography className="mt-1 text-destructive" data-save-error-code={finalizeApplicationCode} variant="memoryMeta">Код: {finalizeApplicationCode}</Typography> : null}
        </> : null}
        <div className="memoly-composer-actions mt-6 flex gap-3">
          <Button className="memoly-composer-primary min-h-12 flex-1" disabled={status === 'saving'} onClick={() => void save()} type="button">Сохранить</Button>
          <Button className="memoly-composer-secondary min-h-12" onClick={cancel} type="button" variant="outline">Отмена</Button>
        </div>
      </section>
    </main>
  )
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  return <div aria-label={label} aria-valuemax={100} aria-valuemin={0} aria-valuenow={value} className="memoly-composer-progress" role="progressbar"><span style={{ width: value + '%' }} /></div>
}

function PhotoPreview({ file, index, onRemove }: { file: File; index: number; onRemove: (index: number) => void }) {
  const [src] = useState<string | null>(() => typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null)
  useEffect(() => {
    return () => { if (src) URL.revokeObjectURL(src) }
  }, [src])
  return <figure className="relative overflow-hidden rounded-[var(--radius-field)] border"><div className="aspect-square bg-muted">{src ? <img alt="" className="h-full w-full object-cover" src={src} /> : null}</div><Typography className="truncate p-1" variant="memoryMeta">{file.name}</Typography><button aria-label={`Удалить ${file.name}`} className="absolute right-1 top-1 rounded-full bg-background px-2 py-1" onClick={() => onRemove(index)} type="button"><Typography aria-hidden variant="memoryMeta">×</Typography></button></figure>
}
