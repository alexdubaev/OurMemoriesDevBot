import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { familyCalendarDate, uploadFamilyPhoto, uploadFamilyVideo } from '@/features/family'
import { ApiRequestError } from '@/platform/api'
import type { AuthenticatedTransport } from '@/platform/api'
import {
  createPhotoIdempotencyKey,
  createMediaMemory,
  resolveComposerFile,
  validateComposerFiles,
} from './api'
import { composerOccurredAt } from './date'
import { AddDateField } from './AddDateField'
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
  const [completedCount, setCompletedCount] = useState(0)
  const [itemStates, setItemStates] = useState<Array<'selected' | 'uploading' | 'ready' | 'failed'>>([])
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [errorStage, setErrorStage] = useState<SaveStage | null>(null)
  const [finalizeApplicationCode, setFinalizeApplicationCode] = useState<string | null>(null)
  const completedAssets = useRef<Array<string | null>>([])
  const idempotencyKey = useRef<string | null>(null)
  const submission = useRef<{ caption: string; date: string; occurredAt: string } | null>(null)
  const saving = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => abortController.current?.abort(), [])

  function chooseFiles(next: File[]) {
    if (saving.current) return
    if (next.length === 0) return
    const selection = [...files, ...next]
    const validation = validateComposerFiles(selection)
    if (!validation.ok) {
      setError(validation.code === 'too_many' ? 'Выберите от 1 до 10 фото и видео.' : 'Поддерживаются JPG, PNG, WebP, HEIC, MP4 и MOV. Видео должно быть от 64 байт до 100 МБ.')
      setErrorStage(null)
      setStatus('error')
      return
    }
    setFiles(selection)
    completedAssets.current = selection.map(() => null)
    setItemStates(selection.map(() => 'selected'))
    idempotencyKey.current = null
    submission.current = null
    setCompletedCount(0)
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
    setItemStates(next.map(() => 'selected'))
    idempotencyKey.current = null
    submission.current = null
    setCompletedCount(0)
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
    if ([...caption].length > 8000) {
      setError('Подпись не может быть длиннее 8 000 символов.')
      setStatus('error')
      return
    }
    const previous = submission.current
    const occurredAt = previous?.caption === caption.trim() && previous.date === occurredDate
      ? previous.occurredAt
      : composerOccurredAt(occurredDate, familyTimezone)
    if (!occurredAt) {
      setError('Дата воспоминания не может быть в будущем.')
      setStatus('error')
      return
    }

    saving.current = true
    setStatus('saving')
    setError(null)
    setErrorStage('reserve')
    const controller = new AbortController()
    abortController.current = controller
    const key = idempotencyKey.current ?? createPhotoIdempotencyKey()
    idempotencyKey.current = key
    submission.current = { caption: caption.trim(), date: occurredDate, occurredAt }

    const saveStage: { current: SaveStage } = { current: 'reserve' }
    try {
      setCompletedCount(completedAssets.current.slice(0, files.length).filter(Boolean).length)
      setItemStates(files.map((_, index) => completedAssets.current[index] ? 'ready' : 'selected'))
      let nextIndex = 0
      let firstFailure: unknown
      let firstFailureStage: SaveStage | null = null
      const worker = async () => {
        while (true) {
          const index = nextIndex++
          if (index >= files.length) return
          if (completedAssets.current[index]) continue
          const file = files[index]
          if (!file) continue
          const media = resolveComposerFile(file)
          if (!media) throw new Error('Поддерживаются JPG, PNG, WebP, HEIC, MP4 и MOV. Видео должно быть от 64 байт до 100 МБ.')
          const itemStage: { current: SaveStage } = { current: 'reserve' }
          try {
            setItemStates((states) => states.map((state, current) => current === index ? 'uploading' : state))
            const onStage = (nextStage: 'reserve' | 'upload' | 'finalize') => { itemStage.current = nextStage; saveStage.current = nextStage; setErrorStage(nextStage) }
            const assetId = media.kind === 'photo'
              ? await uploadFamilyPhoto(transport, familyId, file, media.contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif', 'memory', controller.signal, onStage)
              : await uploadFamilyVideo(transport, familyId, file, media.contentType as 'video/mp4' | 'video/quicktime', controller.signal, onStage)
            if (completedAssets.current.some((existing, assetIndex) => assetIndex !== index && existing === assetId)) throw new Error('Повторяется загруженное медиа.')
            completedAssets.current[index] = assetId
            setItemStates((states) => states.map((state, current) => current === index ? 'ready' : state))
            setCompletedCount((count) => count + 1)
          } catch (reason) {
            setItemStates((states) => states.map((state, current) => current === index ? 'failed' : state))
            if (!firstFailure) { firstFailure = reason; firstFailureStage = itemStage.current }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => worker()))
      if (firstFailure) { saveStage.current = firstFailureStage ?? saveStage.current; throw firstFailure }
      const mediaIds = completedAssets.current.slice(0, files.length)
      if (mediaIds.some((id) => !id) || new Set(mediaIds).size !== mediaIds.length) throw new Error('Не удалось подготовить все вложения.')
      const kinds = files.map((file) => resolveComposerFile(file)?.kind)
      const kind = kinds.every((item) => item === 'photo') ? 'photo' as const
        : kinds.every((item) => item === 'video') && files.length === 1 ? 'video' as const
          : 'media' as const

      saveStage.current = 'create'
      setErrorStage(saveStage.current)
      await createMediaMemory(transport, familyId, {
        kind,
        childId,
        body: caption.trim(),
        occurredAt,
        mediaIds: mediaIds as string[],
        idempotencyKey: key,
      }, controller.signal)
      setStatus('success')
    } catch (reason) {
      if (controller.signal.aborted) return
      setErrorStage(saveStage.current)
      setStatus('error')
      if (saveStage.current === 'finalize') setFinalizeApplicationCode(safeFinalizeApplicationCode(reason))
      setError(saveStage.current === 'reserve'
        ? `${containsVideo ? 'Не удалось подготовить сохранение фото или видео' : 'Не удалось подготовить сохранение фотографий'}. Попробуйте ещё раз.`
        : saveStage.current === 'upload'
          ? `Не удалось загрузить ${containsVideo ? 'фото или видео' : 'фотографию'}. Попробуйте ещё раз.`
          : saveStage.current === 'finalize'
            ? `Не удалось подтвердить ${containsVideo ? 'фото или видео' : 'фотографию'}. Попробуйте ещё раз.`
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

  function addAnother() {
    setFiles([])
    setCaption('')
    setOccurredDate(familyCalendarDate(familyTimezone))
    setCompletedCount(0)
    setStatus('idle')
    setError(null)
    setErrorStage(null)
    setFinalizeApplicationCode(null)
    completedAssets.current = []
    setItemStates([])
    idempotencyKey.current = null
    submission.current = null
  }

  const containsVideo = files.some((file) => resolveComposerFile(file)?.kind === 'video')
  return <main className="memoly-add-page" data-add-screen="photo">
    {status === 'success' ? <section aria-label={containsVideo ? 'Воспоминание опубликовано' : 'Фото опубликованы'} className="memoly-add-success" role="status"><Typography aria-hidden as="span" className="memoly-add-success-mark" variant="memoryScreen">✓</Typography><Typography as="h1" variant="memoryScreen">{containsVideo ? 'Воспоминание опубликовано!' : 'Фото опубликованы!'}</Typography><Typography as="p" variant="memoryBody">Теперь они в ленте воспоминаний</Typography><div className="memoly-add-success-actions"><Button onClick={() => void onSuccess()} type="button">Смотреть в ленте</Button><Button onClick={addAnother} type="button" variant="outline">Добавить ещё</Button></div></section> : status === 'error' && errorStage ? <section aria-label={containsVideo ? 'Не удалось загрузить медиа' : 'Не удалось загрузить фото'} className="memoly-add-success memoly-add-failure" role="alert"><WebpIcon decorative name="warning" size={64} /><Typography as="h1" variant="memoryScreen">{containsVideo ? 'Не удалось загрузить медиа' : 'Не удалось загрузить фото'}</Typography><Typography as="p" variant="memoryBody">{error}</Typography>{finalizeApplicationCode ? <Typography as="small" data-save-error-code={finalizeApplicationCode} variant="memoryMeta">Код: {finalizeApplicationCode}</Typography> : null}<div className="memoly-add-success-actions"><Button onClick={() => void save()} type="button">Попробовать снова</Button><Button onClick={() => { setErrorStage(null); setStatus('idle'); setError(null) }} type="button" variant="outline">{containsVideo ? 'Вернуться к вложениям' : 'Вернуться к фото'}</Button></div></section> : <>
      <header className="memoly-add-topbar"><button aria-label="Назад" className="memoly-add-back" disabled={status === 'saving'} onClick={cancel} type="button"><WebpIcon decorative name="chevron" size={20} /></button><Typography as="h1" id="photo-composer-title" variant="memoryScreen">{containsVideo ? 'Добавить фото и видео' : 'Добавить фото'}</Typography><span /></header>
      <section aria-labelledby="photo-composer-title" className="memoly-add-body">
        <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov" className="memoly-add-native-file" disabled={status === 'saving' || files.length >= 10} id="photo-composer-files" multiple onChange={(event) => { chooseFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} ref={fileInput} type="file" />
        {files.length ? <div aria-label={containsVideo ? 'Предпросмотр вложений' : 'Предпросмотр фотографий'} className="memoly-add-photo-grid">{files.map((file, index) => <MediaPreview file={file} index={index} key={`${file.name}-${file.lastModified}-${index}`} onRemove={removeFile} state={itemStates[index] ?? 'selected'} showState={itemStates.some((state) => state !== 'selected')} />)}{files.length < 10 ? <label className="memoly-add-more" htmlFor="photo-composer-files"><WebpIcon decorative name="plus" size={26} /><Typography as="span" variant="memoryMeta">Добавить<br />до 10 файлов</Typography></label> : null}</div> : <label className="memoly-add-photo-picker" htmlFor="photo-composer-files"><span className="memoly-add-picker-icon"><WebpIcon decorative name="photo" size={34} /></span><Typography as="strong" variant="memoryBodyMedium">Выберите фото и видео</Typography><Typography as="span" variant="memoryMeta">Нажмите, чтобы выбрать<br />до 10 вложений</Typography></label>}
        <div className="memoly-add-caption"><textarea aria-label={containsVideo ? 'Подпись к воспоминанию' : 'Подпись к фотографиям'} disabled={status === 'saving'} id="photo-composer-caption" onChange={(event) => { if (event.currentTarget.value !== caption) { idempotencyKey.current = null; submission.current = null }; setCaption(event.currentTarget.value) }} placeholder="Добавьте подпись (необязательно)" value={caption} /><Typography as="span" variant="memoryMeta">{[...caption].length}/8000</Typography></div>
        <AddDateField id="photo-composer-date" label={containsVideo ? 'Дата воспоминания' : 'Дата фотографий'} onChange={(value) => { if (value !== occurredDate) { idempotencyKey.current = null; submission.current = null }; setOccurredDate(value) }} today={familyCalendarDate(familyTimezone)} value={occurredDate} />
        <Button className="memoly-add-publish" disabled={status === 'saving' || !files.length || [...caption].length > 8000} onClick={() => void save()} type="button">Опубликовать{files.length ? ` (${files.length})` : ''}</Button>
        {status === 'saving' ? <div aria-live="polite" className="memoly-add-loading" role="status"><ProgressBar label="Сохранение вложений" /><Typography as="p" variant="memoryBody">{errorStage === 'reserve' ? 'Подготавливаем вложения…' : errorStage === 'upload' ? 'Загружаем вложения…' : errorStage === 'finalize' ? 'Обрабатываем вложения…' : 'Публикуем воспоминание…'}</Typography><Typography as="p" variant="memoryMeta">Готово вложений: {completedCount} из {files.length}</Typography><Button onClick={cancel} type="button" variant="outline">Отменить</Button></div> : null}
        {error ? <div className="memoly-add-error" data-save-stage={errorStage ?? undefined} role="alert"><WebpIcon decorative name="warning" size={28} /><Typography as="p" variant="memoryBody">{error}</Typography>{finalizeApplicationCode ? <Typography as="small" data-save-error-code={finalizeApplicationCode} variant="memoryMeta">Код: {finalizeApplicationCode}</Typography> : null}{files.length ? <Button onClick={() => void save()} type="button">Повторить</Button> : null}</div> : null}
      </section>
    </>}
  </main>
}

function ProgressBar({ label }: { label: string }) {
  return <div aria-label={label} className="memoly-composer-progress" role="progressbar"><span className="memoly-composer-progress-indeterminate" /></div>
}

function MediaPreview({ file, index, onRemove, state, showState }: { file: File; index: number; onRemove: (index: number) => void; state: 'selected' | 'uploading' | 'ready' | 'failed'; showState: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const isVideo = resolveComposerFile(file)?.kind === 'video'
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const nextSrc = URL.createObjectURL(file)
    let active = true
    queueMicrotask(() => { if (active) setSrc(nextSrc) })
    return () => { active = false; URL.revokeObjectURL(nextSrc) }
  }, [file])
  const stateLabel = state === 'uploading' ? 'Загружается' : state === 'ready' ? 'Готово' : state === 'failed' ? 'Ошибка загрузки' : 'Выбрано'
  return <figure className="memoly-add-photo-thumb" data-media-kind={isVideo ? 'video' : 'photo'}>{src ? (isVideo ? <video aria-label={`Предпросмотр видео ${index + 1}`} muted playsInline preload="metadata" src={src} /> : <img alt={`Выбранное фото ${index + 1}`} src={src} />) : <Typography as="span" variant="memoryMeta">{file.name}</Typography>}<Typography aria-label={`Вложение ${index + 1}`} as="span" className="memoly-add-media-order" variant="memoryMeta">{index + 1}</Typography>{isVideo ? <span className="memoly-add-video-label"><Typography as="span" variant="memoryMeta">Видео</Typography></span> : null}{showState ? <Typography as="span" aria-label={`${file.name}: ${stateLabel}`} className={`memoly-add-upload-state is-${state}`} variant="memoryMeta">{stateLabel}</Typography> : null}<button aria-label={`Удалить ${file.name}`} onClick={() => onRemove(index)} type="button"><Typography aria-hidden as="span" variant="memoryBody">×</Typography></button></figure>
}
