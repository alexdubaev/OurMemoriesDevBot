import { useEffect, useRef, useState } from 'react'
import { MAX_DIRECT_VIDEO_MAX_BYTES } from '@web-app-demo/contracts'
import { ZodError } from 'zod'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { familyCalendarDate, uploadFamilyPhoto } from '@/features/family'
import { finalizeMaxVideo, reserveMaxVideo, uploadVideoToMax } from '@/features/max-video-upload'
import { ApiRequestError } from '@/platform/api'
import type { AuthenticatedTransport } from '@/platform/api'
import {
  createPhotoIdempotencyKey,
  createMediaMemory,
  resolveComposerFile,
  validateComposerFiles,
  validateSize,
  verifyComposerFile,
} from './api'
import type { ComposerMedia } from './api'
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

class UnsupportedComposerFileError extends Error {}
class AmbiguousMaxUploadTerminalError extends Error {}

function videoSizeError(file: File) {
  return `Видео ${(file.size / 1_000_000).toFixed(1).replace('.', ',')} МБ (${file.size.toLocaleString('ru-RU')} байт) превышает предел 250 МБ.`
}

function canonicalVideoName(file: File, contentType: string) {
  const extension = contentType === 'video/quicktime' ? 'mov' : contentType === 'video/x-matroska' ? 'mkv' : contentType === 'video/webm' ? 'webm' : 'mp4'
  if (file.name.toLowerCase().endsWith(`.${extension}`)) return file.name
  const basename = file.name.replace(/\.[^.]+$/, '') || 'video'
  return `${basename}.${extension}`
}

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
  const [preflightKinds, setPreflightKinds] = useState<Array<'photo' | 'video'> | null>(null)
  const completedAssets = useRef<Array<string | null>>([])
  const verifiedMedia = useRef<ComposerMedia[] | null>(null)
  const reserveKeys = useRef<Array<string | null>>([])
  const maxCapabilities = useRef<Array<{ sessionId: string; uploadUrl?: string; uploadToken: string; uploaded: boolean; uploadAttempts: number; recoverUpload: boolean; ambiguousUpload: boolean; restartRequired: boolean } | null>>([])
  const idempotencyKey = useRef<string | null>(null)
  const submission = useRef<{ caption: string; date: string; occurredAt: string } | null>(null)
  const saving = useRef(false)
  const abortController = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [createUncertain, setCreateUncertain] = useState(false)
  const [restartRequiredIndex, setRestartRequiredIndex] = useState<number | null>(null)

  useEffect(() => () => abortController.current?.abort(), [])

  function chooseFiles(next: File[]) {
    if (saving.current || createUncertain || restartRequiredIndex !== null) return
    if (next.length === 0) return
    const selection = [...files, ...next]
    const validation = validateComposerFiles(selection)
    if (!validation.ok) {
      setError(validation.code === 'too_many' ? 'Выберите от 1 до 10 фото и видео.'
        : validation.code === 'too_large_photo' ? 'Фото должно быть не больше 20 МБ.'
          : validation.code === 'too_large_video' ? videoSizeError(selection.find((file) => file.size > MAX_DIRECT_VIDEO_MAX_BYTES)!)
            : validation.code === 'too_small' ? 'Файл должен быть не меньше 64 байт.'
              : 'Поддерживаются JPG, PNG, WebP, HEIC, HEIF, MP4, MOV, MKV и WebM.')
      setErrorStage(null)
      setStatus('error')
      return
    }
    setFiles(selection)
    setPreflightKinds(null)
    completedAssets.current = selection.map(() => null)
    verifiedMedia.current = null
    reserveKeys.current = selection.map(() => null)
    maxCapabilities.current = selection.map(() => null)
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
    if (saving.current || createUncertain || restartRequiredIndex !== null && index !== restartRequiredIndex) return
    const next = files.filter((_, current) => current !== index)
    setFiles(next)
    setPreflightKinds(null)
    completedAssets.current = next.map(() => null)
    verifiedMedia.current = null
    reserveKeys.current = next.map(() => null)
    maxCapabilities.current = next.map(() => null)
    setRestartRequiredIndex(null)
    setItemStates(next.map(() => 'selected'))
    idempotencyKey.current = null
    submission.current = null
    setCompletedCount(0)
    setError(null)
    setStatus(next.length ? 'idle' : 'idle')
    if (fileInput.current) fileInput.current.value = ''
  }

  function invalidateMetadata(changed: 'caption' | 'date') {
    idempotencyKey.current = null
    if (changed === 'date') submission.current = null
  }

  async function uploadMaxAttachment(file: File, mimeType: string, index: number, reserveKey: string, onStage: (stage: 'reserve' | 'upload' | 'finalize') => void, signal: AbortSignal) {
    const requireRestart = (current: NonNullable<(typeof maxCapabilities.current)[number]>) => {
      maxCapabilities.current[index] = { ...current, restartRequired: true }
      setRestartRequiredIndex(index)
      throw new AmbiguousMaxUploadTerminalError('Результат загрузки видео не удалось подтвердить. Удалите это видео и выберите его снова, чтобы начать новую загрузку.')
    }
    let capability = maxCapabilities.current[index]
    if (capability?.restartRequired) {
      onStage('finalize')
      requireRestart(capability)
    }
    if (!capability) {
      onStage('reserve')
      const reservation = await reserveMaxVideo(transport, familyId, {
        childId, body: '', occurredAt: submission.current!.occurredAt, file,
        idempotencyKey: reserveKey, mode: 'attachment', mimeType, fileName: canonicalVideoName(file, mimeType),
      }, signal)
      if (!reservation.uploadToken || !reservation.uploadUrl) {
        reserveKeys.current[index] = null
        throw new Error('Не удалось подготовить загрузку видео')
      }
      capability = { sessionId: reservation.sessionId, uploadUrl: reservation.uploadUrl, uploadToken: reservation.uploadToken, uploaded: false, uploadAttempts: 0, recoverUpload: false, ambiguousUpload: false, restartRequired: false }
      maxCapabilities.current[index] = capability
    }
    if (capability.recoverUpload) {
      onStage('finalize')
      try {
        const recovered = await finalizeMaxVideo(transport, familyId, capability.sessionId, capability.uploadToken, signal)
        if (recovered.state === 'finalized') return recovered.sessionId
        if (recovered.state === 'expired' || recovered.state === 'failed' && !recovered.retryable) {
          if (capability.uploaded || capability.ambiguousUpload) requireRestart(capability)
          maxCapabilities.current[index] = null
          reserveKeys.current[index] = null
          throw new Error('Срок загрузки видео истёк. Попробуйте снова.')
        }
        if (recovered.code !== 'upload_not_ready') throw new Error('MAX ещё обрабатывает видео. Попробуйте снова.')
      } catch (error) {
        if (error instanceof ApiRequestError && (capability.uploaded || capability.ambiguousUpload) && (error.code === 'UPLOAD_EXPIRED' || error.code === 'CONFLICT')) requireRestart(capability)
        if (!(error instanceof ApiRequestError && error.code === 'UPLOAD_NOT_READY')) throw error
      }
      if (capability.uploadAttempts >= 2) requireRestart(capability)
      capability = { ...capability, recoverUpload: false }
      maxCapabilities.current[index] = capability
    }
    if (!capability.uploaded) {
      if (!capability.uploadUrl) throw new Error('Не удалось подготовить загрузку видео')
      onStage('upload')
      try {
        await uploadVideoToMax(capability.uploadUrl, file, signal)
      } catch (error) {
        maxCapabilities.current[index] = { ...capability, uploadAttempts: capability.uploadAttempts + 1, recoverUpload: true, ambiguousUpload: true }
        throw error
      }
      capability = { ...capability, uploadUrl: undefined, uploaded: true, uploadAttempts: capability.uploadAttempts + 1, recoverUpload: false }
      maxCapabilities.current[index] = capability
    }
    onStage('finalize')
    let result: Awaited<ReturnType<typeof finalizeMaxVideo>>
    try {
      result = await finalizeMaxVideo(transport, familyId, capability.sessionId, capability.uploadToken, signal)
    } catch (error) {
      if ((capability.uploaded || capability.ambiguousUpload) && error instanceof ApiRequestError && (error.code === 'UPLOAD_EXPIRED' || error.code === 'CONFLICT')) requireRestart(capability)
      throw error
    }
    if (result.state !== 'finalized') {
      if (result.state === 'expired' || result.state === 'failed' && !result.retryable) {
        if (capability.uploaded || capability.ambiguousUpload) requireRestart(capability)
        maxCapabilities.current[index] = null
        reserveKeys.current[index] = null
      }
      throw new Error('MAX ещё обрабатывает видео. Попробуйте снова.')
    }
    return result.sessionId
  }

  async function save() {
    if (saving.current) return
    if (restartRequiredIndex !== null) return
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
    const occurredAt = previous?.date === occurredDate
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
      const mediaItems: ComposerMedia[] = verifiedMedia.current ?? []
      if (!verifiedMedia.current) {
        for (const file of files) {
          controller.signal.throwIfAborted()
          const media = await verifyComposerFile(file)
          if (!media) throw new UnsupportedComposerFileError('Файл не соответствует поддерживаемому формату.')
          const validation = validateSize(file, media)
          if (!validation.ok) throw new UnsupportedComposerFileError(validation.code === 'too_large_photo' ? 'Фото должно быть не больше 20 МБ.' : validation.code === 'too_large_video' ? videoSizeError(file) : 'Файл должен быть не меньше 64 байт.')
          mediaItems.push(media)
        }
        verifiedMedia.current = mediaItems
      }
      controller.signal.throwIfAborted()
      setPreflightKinds(mediaItems.map((media) => media.kind))
      setCompletedCount(completedAssets.current.slice(0, files.length).filter(Boolean).length)
      setItemStates(files.map((_, index) => completedAssets.current[index] ? 'ready' : 'selected'))
      let firstFailure: unknown
      let firstFailureStage: SaveStage | null = null
      for (let index = 0; index < files.length; index += 1) {
          controller.signal.throwIfAborted()
          if (completedAssets.current[index]) continue
          const file = files[index]
          if (!file) continue
          const itemStage: { current: SaveStage } = { current: 'reserve' }
          try {
            setItemStates((states) => states.map((state, current) => current === index ? 'uploading' : state))
            const media = mediaItems[index]!
            const onStage = (nextStage: 'reserve' | 'upload' | 'finalize') => { itemStage.current = nextStage; setErrorStage(nextStage) }
            const reserveKey = reserveKeys.current[index] ?? createPhotoIdempotencyKey()
            reserveKeys.current[index] = reserveKey
            const assetId = media.kind === 'photo'
              ? await uploadFamilyPhoto(transport, familyId, file, media.contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif', 'memory', controller.signal, onStage, reserveKey)
              : await uploadMaxAttachment(file, media.contentType, index, reserveKey, onStage, controller.signal)
            if (completedAssets.current.some((existing, assetIndex) => assetIndex !== index && existing === assetId)) throw new Error('Повторяется загруженное медиа.')
            completedAssets.current[index] = assetId
            setItemStates((states) => states.map((state, current) => current === index ? 'ready' : state))
            setCompletedCount((count) => count + 1)
          } catch (reason) {
            if (controller.signal.aborted) throw reason
            if (reason instanceof ApiRequestError && (['UPLOAD_EXPIRED', 'PHOTO_FINALIZE_RESERVATION_EXPIRED'].includes(reason.code) || (itemStage.current === 'reserve' && reason.code === 'STORAGE_UNAVAILABLE'))) reserveKeys.current[index] = null
            if (mediaItems[index]?.kind === 'video' && reason instanceof ApiRequestError && (reason.code === 'UPLOAD_EXPIRED' || reason.code === 'CONFLICT')) { reserveKeys.current[index] = null; maxCapabilities.current[index] = null }
            setItemStates((states) => states.map((state, current) => current === index ? 'failed' : state))
            if (!firstFailure || reason instanceof AmbiguousMaxUploadTerminalError) { firstFailure = reason; firstFailureStage = itemStage.current }
          }
      }
      if (firstFailure) { saveStage.current = firstFailureStage ?? saveStage.current; throw firstFailure }
      const mediaIds = completedAssets.current.slice(0, files.length)
      if (mediaIds.some((id) => !id) || new Set(mediaIds).size !== mediaIds.length) throw new Error('Не удалось подготовить все вложения.')
      const kinds = mediaItems.map((media) => media.kind)
      const kind = kinds.every((item) => item === 'photo') ? 'photo' as const : 'media' as const

      saveStage.current = 'create'
      setErrorStage(saveStage.current)
      setCreateUncertain(true)
      await createMediaMemory(transport, familyId, {
        kind,
        childId,
        body: caption.trim(),
        occurredAt,
        ...(kind === 'photo' ? { mediaIds: mediaIds as string[] } : { attachments: mediaIds.map((id, index) => mediaItems[index]!.kind === 'video'
          ? { source: 'max' as const, sessionId: id! }
          : { source: 'private_storage' as const, mediaId: id! }) }),
        idempotencyKey: key,
      }, controller.signal)
      setStatus('success')
    } catch (reason) {
      if (controller.signal.aborted) return
      if (saveStage.current === 'create' && (reason instanceof ZodError || reason instanceof ApiRequestError && reason.status >= 400 && reason.status < 500 && reason.status !== 408 && reason.status !== 429)) setCreateUncertain(false)
      if (reason instanceof UnsupportedComposerFileError) {
        setErrorStage(null)
        setError(reason.message)
        setStatus('error')
        return
      }
      if (reason instanceof AmbiguousMaxUploadTerminalError) {
        setErrorStage('finalize')
        setError(reason.message)
        setStatus('error')
        return
      }
      setErrorStage(saveStage.current)
      setStatus('error')
      if (saveStage.current === 'finalize') setFinalizeApplicationCode(safeFinalizeApplicationCode(reason))
      setError(saveStage.current === 'reserve' && reason instanceof ApiRequestError && reason.status === 403
        ? 'Нет доступа к загрузке в эту семью.'
        : saveStage.current === 'reserve' && reason instanceof ApiRequestError && reason.code === 'FILE_TOO_LARGE'
          ? 'Недостаточно свободного места или слишком много незавершённых загрузок. Попробуйте позже.'
          : saveStage.current === 'reserve' && reason instanceof ApiRequestError && reason.code === 'STORAGE_UNAVAILABLE'
            ? 'Хранилище временно недоступно. Попробуйте ещё раз.'
            : saveStage.current === 'reserve'
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
    if (createUncertain) return
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
    setPreflightKinds(null)
    setCaption('')
    setOccurredDate(familyCalendarDate(familyTimezone))
    setCompletedCount(0)
    setStatus('idle')
    setError(null)
    setErrorStage(null)
    setFinalizeApplicationCode(null)
    completedAssets.current = []
    verifiedMedia.current = null
    reserveKeys.current = []
    maxCapabilities.current = []
    setRestartRequiredIndex(null)
    setCreateUncertain(false)
    setItemStates([])
    idempotencyKey.current = null
    submission.current = null
  }

  const containsVideo = preflightKinds?.some((kind) => kind === 'video') ?? files.some((file) => resolveComposerFile(file)?.kind === 'video')
  return <main className="memoly-add-page" data-add-screen="photo">
    {status === 'success' ? <section aria-label={containsVideo ? 'Воспоминание опубликовано' : 'Фото опубликованы'} className="memoly-add-success" role="status"><Typography aria-hidden as="span" className="memoly-add-success-mark" variant="memoryScreen">✓</Typography><Typography as="h1" variant="memoryScreen">{containsVideo ? 'Воспоминание опубликовано!' : 'Фото опубликованы!'}</Typography><Typography as="p" variant="memoryBody">Теперь они в ленте воспоминаний</Typography><div className="memoly-add-success-actions"><Button onClick={() => void onSuccess()} type="button">Смотреть в ленте</Button><Button onClick={addAnother} type="button" variant="outline">Добавить ещё</Button></div></section> : status === 'error' && errorStage ? <section aria-label={containsVideo ? 'Не удалось загрузить медиа' : 'Не удалось загрузить фото'} className="memoly-add-success memoly-add-failure" role="alert"><WebpIcon decorative name="warning" size={64} /><Typography as="h1" variant="memoryScreen">{containsVideo ? 'Не удалось загрузить медиа' : 'Не удалось загрузить фото'}</Typography><Typography as="p" variant="memoryBody">{error}</Typography>{createUncertain && errorStage === 'create' ? <Typography as="p" variant="memoryMeta">Ответ о публикации не получен. Повторите сохранение этой же заявки, чтобы проверить результат.</Typography> : null}{finalizeApplicationCode ? <Typography as="small" data-save-error-code={finalizeApplicationCode} variant="memoryMeta">Код: {finalizeApplicationCode}</Typography> : null}<div className="memoly-add-success-actions">{restartRequiredIndex === null ? <Button onClick={() => void save()} type="button">Попробовать снова</Button> : null}{createUncertain ? null : <Button onClick={() => { setErrorStage(null); setStatus('idle'); setError(null) }} type="button" variant="outline">{containsVideo ? 'Вернуться к вложениям' : 'Вернуться к фото'}</Button>}</div></section> : <>
      <header className="memoly-add-topbar"><button aria-label="Назад" className="memoly-add-back" disabled={status === 'saving' || createUncertain} onClick={cancel} type="button"><WebpIcon decorative name="chevron" size={20} /></button><Typography as="h1" id="photo-composer-title" variant="memoryScreen">Добавить фото и видео</Typography><span /></header>
      <section aria-labelledby="photo-composer-title" className="memoly-add-body">
        <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/x-matroska,video/webm,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.mkv,.webm" className="memoly-add-native-file" disabled={status === 'saving' || createUncertain || restartRequiredIndex !== null || files.length >= 10} id="photo-composer-files" multiple onChange={(event) => { chooseFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '' }} ref={fileInput} type="file" />
        {files.length ? <div aria-label={containsVideo ? 'Предпросмотр вложений' : 'Предпросмотр фотографий'} className="memoly-add-photo-grid">{files.map((file, index) => <MediaPreview file={file} index={index} key={`${file.name}-${file.lastModified}-${index}`} kind={preflightKinds?.[index]} onRemove={removeFile} removeDisabled={restartRequiredIndex !== null && index !== restartRequiredIndex} state={itemStates[index] ?? 'selected'} showState={itemStates.some((state) => state !== 'selected')} />)}{files.length < 10 ? <label className="memoly-add-more" htmlFor="photo-composer-files"><WebpIcon decorative name="plus" size={26} /><Typography as="span" variant="memoryMeta">Добавить<br />до 10 файлов</Typography></label> : null}</div> : <label className="memoly-add-photo-picker" htmlFor="photo-composer-files"><span className="memoly-add-picker-icon"><WebpIcon decorative name="photo" size={34} /></span><Typography as="strong" variant="memoryBodyMedium">Выберите фото и видео</Typography><Typography as="span" variant="memoryMeta">Нажмите, чтобы выбрать<br />до 10 вложений</Typography></label>}
        <div className="memoly-add-caption"><textarea aria-label={containsVideo ? 'Подпись к воспоминанию' : 'Подпись к фотографиям'} disabled={status === 'saving' || createUncertain} id="photo-composer-caption" onChange={(event) => { if (event.currentTarget.value !== caption) { invalidateMetadata('caption') }; setCaption(event.currentTarget.value) }} placeholder="Добавьте подпись (необязательно)" value={caption} /><Typography as="span" variant="memoryMeta">{[...caption].length}/8000</Typography></div>
        <AddDateField disabled={status === 'saving' || createUncertain} id="photo-composer-date" label={containsVideo ? 'Дата воспоминания' : 'Дата фотографий'} onChange={(value) => { if (value !== occurredDate) { invalidateMetadata('date') }; setOccurredDate(value) }} today={familyCalendarDate(familyTimezone)} value={occurredDate} />
        <Button className="memoly-add-publish" disabled={status === 'saving' || restartRequiredIndex !== null || !files.length || [...caption].length > 8000} onClick={() => void save()} type="button">Опубликовать{files.length ? ` (${files.length})` : ''}</Button>
        {status === 'saving' ? <div aria-live="polite" className="memoly-add-loading" role="status"><ProgressBar label="Сохранение вложений" /><Typography as="p" variant="memoryBody">{errorStage === 'reserve' ? 'Подготавливаем вложения…' : errorStage === 'upload' ? 'Загружаем вложения…' : errorStage === 'finalize' ? 'Обрабатываем вложения…' : 'Публикуем воспоминание…'}</Typography><Typography as="p" variant="memoryMeta">Готово вложений: {completedCount} из {files.length}</Typography><Button disabled={createUncertain} onClick={cancel} type="button" variant="outline">Отменить</Button></div> : null}
        {error ? <div className="memoly-add-error" data-save-stage={errorStage ?? undefined} role="alert"><WebpIcon decorative name="warning" size={28} /><Typography as="p" variant="memoryBody">{error}</Typography>{finalizeApplicationCode ? <Typography as="small" data-save-error-code={finalizeApplicationCode} variant="memoryMeta">Код: {finalizeApplicationCode}</Typography> : null}{files.length ? <Button onClick={() => void save()} type="button">Повторить</Button> : null}</div> : null}
      </section>
    </>}
  </main>
}

function ProgressBar({ label }: { label: string }) {
  return <div aria-label={label} className="memoly-composer-progress" role="progressbar"><span className="memoly-composer-progress-indeterminate" /></div>
}

function MediaPreview({ file, index, kind, onRemove, removeDisabled, state, showState }: { file: File; index: number; kind?: 'photo' | 'video'; onRemove: (index: number) => void; removeDisabled?: boolean; state: 'selected' | 'uploading' | 'ready' | 'failed'; showState: boolean }) {
  const [src, setSrc] = useState<string | null>(null)
  const isVideo = (kind ?? resolveComposerFile(file)?.kind) === 'video'
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const nextSrc = URL.createObjectURL(file)
    let active = true
    queueMicrotask(() => { if (active) setSrc(nextSrc) })
    return () => { active = false; URL.revokeObjectURL(nextSrc) }
  }, [file])
  const stateLabel = state === 'uploading' ? 'Загружается' : state === 'ready' ? 'Готово' : state === 'failed' ? 'Ошибка загрузки' : 'Выбрано'
  return <figure className="memoly-add-photo-thumb" data-media-kind={isVideo ? 'video' : 'photo'}>{src ? (isVideo ? <video aria-label={`Предпросмотр видео ${index + 1}`} muted playsInline preload="metadata" src={src} /> : <img alt={`Выбранное фото ${index + 1}`} src={src} />) : <Typography as="span" variant="memoryMeta">{file.name}</Typography>}<Typography aria-label={`Вложение ${index + 1}`} as="span" className="memoly-add-media-order" variant="memoryMeta">{index + 1}</Typography>{isVideo ? <span className="memoly-add-video-label"><Typography as="span" variant="memoryMeta">Видео</Typography></span> : null}{showState ? <Typography as="span" aria-label={`${file.name}: ${stateLabel}`} className={`memoly-add-upload-state is-${state}`} variant="memoryMeta">{stateLabel}</Typography> : null}<button aria-label={`Удалить ${file.name}`} disabled={removeDisabled} onClick={() => onRemove(index)} type="button"><Typography aria-hidden as="span" variant="memoryBody">×</Typography></button></figure>
}
