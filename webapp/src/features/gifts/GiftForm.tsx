import { useEffect, useId, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from 'react'
import { giftUrlSchema, type CreateGiftRequest, type GiftDto, type GiftMetadataResponse, type UpdateGiftRequest } from '@web-app-demo/contracts'

import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { resolveWebpIconSource } from '@/components/webp-icon-manifest'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { createIdempotencyKey, validateSize, verifyComposerFile } from '@/features/composer'
import { uploadFamilyPhoto } from '@/features/family'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'

import { createGift, giftPhotoPath, loadGiftMetadata, updateGift } from './api'
import { giftFailureMessage, isGiftStateConflict, parseGiftShareClipboard, photoErrorMessage, shopName, validateGiftDraft } from './model'

type PhotoContentType = Parameters<typeof uploadFamilyPhoto>[3]

type PickedPhoto = {
  file: File
  contentType: PhotoContentType
  previewUrl: string
  /** Set once the file reached storage, so a retry does not upload it again. */
  mediaId: string | null
  key: string
}

async function fetchGiftFallbackIcon(signal: AbortSignal): Promise<File> {
  const controller = new AbortController()
  let timedOut = false
  const abortWithSave = () => controller.abort()
  if (signal.aborted) abortWithSave()
  else signal.addEventListener('abort', abortWithSave, { once: true })
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 10_000)
  try {
    const iconUrl = resolveWebpIconSource('gift', 'default', 3).src
    const response = await fetch(iconUrl, { credentials: 'same-origin', signal: controller.signal })
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('image/webp')) {
      throw new Error('Не удалось подготовить значок подарка')
    }
    const blob = await response.blob()
    if (timedOut) throw new Error('Не удалось подготовить значок подарка')
    return new File([blob], 'gift-default.webp', { type: 'image/webp' })
  } catch (error) {
    if (timedOut) throw new Error('Не удалось подготовить значок подарка', { cause: error })
    throw error
  } finally {
    window.clearTimeout(timeout)
    signal.removeEventListener('abort', abortWithSave)
  }
}

export type GiftFormTarget = { mode: 'create' } | { mode: 'edit'; gift: GiftDto }

export type GiftFormSheetProps = {
  accountId: string
  familyId: string
  /** The sheet only opens on the visible tab. */
  open: boolean
  onClose: () => void
  onSaved: (gift: GiftDto) => void
  /** The gift changed or vanished under an edit: the page reloads the list and says so. */
  onStale: (message: string) => void
  scopeKey: string
  target: GiftFormTarget | null
  transport: AuthenticatedTransport
}

export function GiftFormSheet({ open, onClose, target, ...props }: GiftFormSheetProps) {
  const [saving, setSaving] = useState(false)
  return (
    <MemolyBottomSheet dismissible={!saving} onOpenChange={(next) => { if (!next && !saving) onClose() }} open={open && target !== null}>
      {open && target ? <GiftFormBody {...props} onBusyChange={setSaving} onClose={onClose} target={target} /> : null}
    </MemolyBottomSheet>
  )
}

function GiftFormBody({ accountId, familyId, onBusyChange, onClose, onSaved, onStale, scopeKey, target, transport }: Omit<GiftFormSheetProps, 'open' | 'target'> & { target: GiftFormTarget; onBusyChange: (busy: boolean) => void }) {
  const editing = target.mode === 'edit' ? target.gift : null
  const ids = { url: useId(), title: useId(), price: useId(), photo: useId() }
  const [url, setUrl] = useState(editing?.url ?? '')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [price, setPrice] = useState(editing?.price ?? '')
  const [photo, setPhoto] = useState<PickedPhoto | null>(null)
  const [photoChecking, setPhotoChecking] = useState(false)
  const urlValue = useRef(url)
  const titleValue = useRef(title)
  const priceValue = useRef(price)
  const photoValue = useRef<PickedPhoto | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [saveProgress, setSaveProgress] = useState('')
  const [metadataStatus, setMetadataStatus] = useState<'idle' | 'loading' | 'ready' | 'partial' | 'unavailable' | 'unsupported' | 'error'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const saving = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const metadataController = useRef<AbortController | null>(null)
  const metadataLookup = useRef<{ url: string; accountId: string; familyId: string; scopeKey: string; promise: Promise<GiftMetadataResponse | null> } | null>(null)
  const requestMetadataRef = useRef<(requestedUrl: string, requestedScope: { accountId: string; familyId: string; scopeKey: string }) => Promise<GiftMetadataResponse | null>>(async () => null)
  const urlEpoch = useRef(0)
  const photoSelectionGeneration = useRef(0)
  const photoSelectionPending = useRef(false)
  const mounted = useRef(false)
  const currentScope = useRef({ accountId, familyId, scopeKey })
  currentScope.current = { accountId, familyId, scopeKey }
  const mountedScope = useRef({ accountId, familyId, scopeKey })
  const manual = useRef({ title: Boolean(editing), price: Boolean(editing), photo: Boolean(editing) })
  const automatic = useRef({ title: false, price: false, photo: false })
  // Same body => same key, so repeating a request that actually reached the server cannot make a second gift.
  const attempt = useRef<{ key: string; signature: string } | null>(null)
  const previewToRevoke = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      metadataController.current?.abort()
      if (previewToRevoke.current) URL.revokeObjectURL(previewToRevoke.current)
    }
  }, [])

  useEffect(() => {
    const previous = mountedScope.current
    if (previous.accountId !== accountId || previous.familyId !== familyId || previous.scopeKey !== scopeKey) {
      mountedScope.current = { accountId, familyId, scopeKey }
      controller.current?.abort()
      metadataController.current?.abort()
      photoSelectionGeneration.current += 1
      photoSelectionPending.current = false
      setPhotoChecking(false)
      revokePickedPhoto()
      setPhotoValue(null)
      onClose()
    }
  }, [accountId, familyId, scopeKey, onClose])

  const currentPhotoUrl = usePrivateImageUrl(
    accountId,
    editing ? giftPhotoPath(familyId, editing.photoMediaId) : null,
    transport,
    Boolean(editing) && !photo,
    undefined,
    scopeKey,
  )
  const draft = validateGiftDraft({ url, title, price })
  const busy = status === 'saving'

  function setPhotoValue(next: PickedPhoto | null) {
    photoValue.current = next
    setPhoto(next)
  }

  function revokePickedPhoto() {
    if (previewToRevoke.current) URL.revokeObjectURL(previewToRevoke.current)
    previewToRevoke.current = null
  }

  function handleUrlChange(nextUrl: string) {
    urlValue.current = nextUrl
    urlEpoch.current += 1
    metadataController.current?.abort()
    metadataLookup.current = null
    if (automatic.current.title && !manual.current.title) { titleValue.current = ''; setTitle(''); automatic.current.title = false }
    if (automatic.current.price && !manual.current.price) { priceValue.current = ''; setPrice(''); automatic.current.price = false }
    if (automatic.current.photo && !manual.current.photo) {
      revokePickedPhoto()
      setPhotoValue(null)
      automatic.current.photo = false
    }
    setMetadataStatus('idle')
    setUrl(nextUrl)
    setFailure(null)
  }

  function requestMetadata(requestedUrl: string, requestedScope: { accountId: string; familyId: string; scopeKey: string }) {
    const existing = metadataLookup.current
    if (existing && existing.url === requestedUrl && existing.accountId === requestedScope.accountId && existing.familyId === requestedScope.familyId && existing.scopeKey === requestedScope.scopeKey) return existing.promise
    metadataController.current?.abort()
    const abort = new AbortController()
    metadataController.current = abort
    const epoch = urlEpoch.current
    const promise = loadGiftMetadata(transport, requestedScope.familyId, requestedUrl, abort.signal).then((metadata) => {
      const scope = currentScope.current
      const isCurrent = mounted.current && !abort.signal.aborted && epoch === urlEpoch.current && urlValue.current.trim() === requestedUrl && scope.accountId === requestedScope.accountId && scope.familyId === requestedScope.familyId && scope.scopeKey === requestedScope.scopeKey
      if (!isCurrent) return null
      if (!saving.current) {
        if (metadata.title && !manual.current.title) {
          titleValue.current = metadata.title
          setTitle(metadata.title)
          automatic.current.title = true
        }
        if (metadata.price && !manual.current.price) {
          priceValue.current = metadata.price
          setPrice(metadata.price)
          automatic.current.price = true
        }
        if (metadata.photo && !manual.current.photo) {
          const binary = atob(metadata.photo.dataBase64)
          const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
          const file = new File([bytes], 'gift-product.webp', { type: metadata.photo.contentType })
          revokePickedPhoto()
          const previewUrl = URL.createObjectURL(file)
          previewToRevoke.current = previewUrl
          const picked = { file, contentType: 'image/webp' as PhotoContentType, previewUrl, mediaId: null, key: createIdempotencyKey() }
          setPhotoValue(picked)
          automatic.current.photo = true
        }
      }
      setMetadataStatus(metadata.status)
      return metadata
    }).catch(() => {
      const scope = currentScope.current
      if (mounted.current && !abort.signal.aborted && epoch === urlEpoch.current && urlValue.current.trim() === requestedUrl && scope.accountId === requestedScope.accountId && scope.familyId === requestedScope.familyId && scope.scopeKey === requestedScope.scopeKey) setMetadataStatus('error')
      return null
    })
    metadataLookup.current = { url: requestedUrl, ...requestedScope, promise }
    setMetadataStatus('loading')
    return promise
  }
  requestMetadataRef.current = requestMetadata

  useEffect(() => {
    if (editing || !giftUrlSchema.safeParse(url.trim()).success) {
      return
    }
    const requestedUrl = url.trim()
    const epoch = urlEpoch.current
    const requestedScope = { ...currentScope.current }
    const timer = window.setTimeout(() => {
      if (epoch === urlEpoch.current && urlValue.current.trim() === requestedUrl) void requestMetadataRef.current(requestedUrl, requestedScope)
    }, 400)
    return () => {
      window.clearTimeout(timer)
    }
  }, [editing, familyId, scopeKey, accountId, transport, url])

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const selectionGeneration = ++photoSelectionGeneration.current
    const scope = { ...currentScope.current }
    photoSelectionPending.current = true
    setPhotoChecking(true)
    try {
      const media = await verifyComposerFile(file)
      const latest = currentScope.current
      if (!mounted.current || selectionGeneration !== photoSelectionGeneration.current || latest.accountId !== scope.accountId || latest.familyId !== scope.familyId || latest.scopeKey !== scope.scopeKey || saving.current) return
      if (!media || media.kind !== 'photo') { setPhotoError(photoErrorMessage('unsupported_format')); return }
      const size = validateSize(file, media)
      if (!size.ok) { setPhotoError(photoErrorMessage(size.code)); return }
      revokePickedPhoto()
      const previewUrl = URL.createObjectURL(file)
      previewToRevoke.current = previewUrl
      setPhotoValue({ file, contentType: media.contentType as PhotoContentType, previewUrl, mediaId: null, key: createIdempotencyKey() })
      manual.current.photo = true
      automatic.current.photo = false
      setPhotoError(null)
      setFailure(null)
    } catch {
      if (mounted.current && selectionGeneration === photoSelectionGeneration.current) setPhotoError(photoErrorMessage('unsupported_format'))
    } finally {
      if (selectionGeneration === photoSelectionGeneration.current) {
        photoSelectionPending.current = false
        if (mounted.current) setPhotoChecking(false)
      }
    }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (saving.current || photoSelectionPending.current || !draft.canSave) return
    saving.current = true
    onBusyChange(true)
    setStatus('saving')
    setSaveProgress('Подготавливаем фото…')
    setFailure(null)
    const abort = new AbortController()
    controller.current = abort
    let stage: 'upload' | 'save' = 'save'
    try {
      const cleanUrl = urlValue.current.trim()
      let metadata: GiftMetadataResponse | null = null
      if (!editing && giftUrlSchema.safeParse(cleanUrl).success) {
        setSaveProgress('Ищем данные товара…')
        metadata = await requestMetadataRef.current(cleanUrl, { ...currentScope.current })
      }
      const currentTitle = titleValue.current.trim()
      const currentPrice = priceValue.current.trim()
      const cleanTitle = (manual.current.title ? currentTitle : metadata?.title ?? currentTitle).trim()
      const cleanPrice = (manual.current.price ? currentPrice : metadata?.price ?? currentPrice).trim()
      let photoToSave = photoValue.current
      if (!manual.current.photo && metadata?.photo && (!photoToSave || !automatic.current.photo)) {
        const binary = atob(metadata.photo.dataBase64)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        const file = new File([bytes], 'gift-product.webp', { type: metadata.photo.contentType })
        revokePickedPhoto()
        const previewUrl = URL.createObjectURL(file)
        previewToRevoke.current = previewUrl
        photoToSave = { file, contentType: 'image/webp', previewUrl, mediaId: null, key: createIdempotencyKey() }
        setPhotoValue(photoToSave)
        automatic.current.photo = true
      }
      if (!editing && !photoToSave) {
        const iconFile = await fetchGiftFallbackIcon(abort.signal)
        const media = await verifyComposerFile(iconFile)
        if (!media || media.kind !== 'photo') throw new Error('Не удалось подготовить значок подарка')
        const previewUrl = URL.createObjectURL(iconFile)
        previewToRevoke.current = previewUrl
        photoToSave = { file: iconFile, contentType: 'image/webp', previewUrl, mediaId: null, key: createIdempotencyKey() }
        setPhotoValue(photoToSave)
        manual.current.photo = false
        automatic.current.photo = true
      }
      let photoMediaId = photoToSave?.mediaId ?? null
      if (photoToSave && !photoMediaId) {
        stage = 'upload'
        setSaveProgress('Загружаем фото в семейное хранилище…')
        photoMediaId = await uploadFamilyPhoto(transport, familyId, photoToSave.file, photoToSave.contentType, 'gift', abort.signal, undefined, photoToSave.key)
        const uploaded = photoMediaId
        const uploadedPhoto = { ...photoToSave, mediaId: uploaded }
        photoValue.current = uploadedPhoto
        setPhoto((current) => (current && current.key === uploadedPhoto.key ? uploadedPhoto : current))
        stage = 'save'
      }
      const savedTitle = cleanTitle || shopName(cleanUrl)
      setSaveProgress('Сохраняем подарок…')
      if (!editing) {
        const body: CreateGiftRequest = {
          title: savedTitle, url: cleanUrl, ...(cleanPrice ? { price: cleanPrice } : {}), photoMediaId: photoMediaId!,
        }
        const signature = JSON.stringify(body)
        if (attempt.current?.signature !== signature) attempt.current = { key: createIdempotencyKey(), signature }
        const { gift } = await createGift(transport, familyId, body, attempt.current.key, abort.signal)
        onSaved(gift)
        return
      }
      const patch: UpdateGiftRequest = { expectedVersion: editing.version }
      if (savedTitle !== editing.title) patch.title = savedTitle
      if (cleanUrl !== editing.url) patch.url = cleanUrl
      if ((cleanPrice || null) !== editing.price) patch.price = cleanPrice || null
      if (photoMediaId) patch.photoMediaId = photoMediaId
      if (Object.keys(patch).length === 1) { onClose(); return }
      const { gift } = await updateGift(transport, familyId, editing.id, patch, abort.signal)
      onSaved(gift)
    } catch (error) {
      if (abort.signal.aborted) return
      if (editing && isGiftStateConflict(error)) { onStale(giftFailureMessage(error)); return }
      // A photo the server refused cannot be reused: pick it up again on the next try.
      if (error instanceof ApiRequestError && error.status === 422) {
        setPhoto((current) => {
          if (!current?.mediaId) return current
          const retryable = { ...current, mediaId: null, key: createIdempotencyKey() }
          photoValue.current = retryable
          return retryable
        })
      }
      setStatus('error')
      setSaveProgress('')
      setFailure(stage === 'upload' && !(error instanceof ApiRequestError)
        ? 'Не удалось загрузить фото. Проверьте соединение и повторите.'
        : giftFailureMessage(error))
    } finally {
      saving.current = false
      onBusyChange(false)
      setStatus((current) => (current === 'saving' ? 'idle' : current))
      setSaveProgress('')
    }
  }

  const previewUrl = photo?.previewUrl ?? currentPhotoUrl
  return (
    <form className="gift-form" data-slot="gift-form" onSubmit={(event) => void save(event)}>
      <DrawerTitle className="gift-form-title">{editing ? 'Изменить подарок' : 'Новый подарок'}</DrawerTitle>
      <DrawerDescription className="gift-form-subtitle">Нужна только ссылка. Название и фото заполнятся автоматически, если данные доступны.</DrawerDescription>

      <div className="gift-field">
        <label htmlFor={ids.url}><Typography as="span" variant="memoryMeta">Ссылка на товар</Typography></label>
        <input
          aria-describedby={draft.errors.url ? `${ids.url}-error` : undefined}
          aria-invalid={draft.errors.url ? true : undefined}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          disabled={busy}
          id={ids.url}
          inputMode="url"
          onChange={(event) => handleUrlChange(event.target.value)}
          onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
            const clipboardText = event.clipboardData.getData('text/plain')
            if (!/[\r\n]/u.test(clipboardText) || giftUrlSchema.safeParse(clipboardText.trim()).success) {
              return
            }
            event.preventDefault()
            const share = parseGiftShareClipboard(clipboardText)
            if (!share) {
              handleUrlChange(clipboardText.replace(/\r\n|[\r\n]/gu, ' '))
              return
            }
            handleUrlChange(share.url)
            if (!manual.current.title || !title.trim()) {
              const shareTitle = share.title.slice(0, 120)
              titleValue.current = shareTitle
              setTitle(shareTitle)
              manual.current.title = true
              automatic.current.title = false
            }
          }}
          placeholder="https://"
          spellCheck={false}
          type="text"
          value={url}
        />
        {draft.errors.url ? <Typography as="span" className="gift-field-error" id={`${ids.url}-error`} role="alert" variant="memoryMeta">{draft.errors.url}</Typography> : null}
      </div>

      <div className="gift-field">
        <label htmlFor={ids.title}><Typography as="span" variant="memoryMeta">Название</Typography></label>
        <input
          aria-describedby={draft.errors.title ? `${ids.title}-error` : undefined}
          aria-invalid={draft.errors.title ? true : undefined}
          autoComplete="off"
          disabled={busy}
          id={ids.title}
          onChange={(event) => { titleValue.current = event.target.value; setTitle(event.target.value); manual.current.title = true; automatic.current.title = false }}
          type="text"
          value={title}
        />
        {draft.errors.title ? <Typography as="span" className="gift-field-error" id={`${ids.title}-error`} role="alert" variant="memoryMeta">{draft.errors.title}</Typography> : null}
      </div>

      <div className="gift-field">
        <label htmlFor={ids.price}><Typography as="span" variant="memoryMeta">Цена, по желанию</Typography></label>
        <input
          aria-describedby={draft.errors.price ? `${ids.price}-error` : undefined}
          aria-invalid={draft.errors.price ? true : undefined}
          autoComplete="off"
          disabled={busy}
          id={ids.price}
          onChange={(event) => { priceValue.current = event.target.value; setPrice(event.target.value); manual.current.price = true; automatic.current.price = false }}
          placeholder="Например, около 3000 ₽"
          type="text"
          value={price}
        />
        {draft.errors.price ? <Typography as="span" className="gift-field-error" id={`${ids.price}-error`} role="alert" variant="memoryMeta">{draft.errors.price}</Typography> : null}
      </div>

      <div className="gift-field">
        <Typography as="span" className="gift-field-label" variant="memoryMeta">Фото, по желанию</Typography>
        <div className="gift-photo-picker">
          <span aria-hidden="true" className="gift-photo-preview">
            {previewUrl ? <img alt="" draggable={false} src={previewUrl} /> : <WebpIcon decorative monochrome name="gift" size={36} />}
          </span>
          <label className="gift-button" htmlFor={ids.photo}>
            <Typography as="span" variant="memoryButton">{photo || editing ? 'Заменить фото' : 'Выбрать фото'}</Typography>
          </label>
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            className="gift-photo-input"
            disabled={busy}
            id={ids.photo}
            onChange={(event) => void choosePhoto(event)}
            type="file"
          />
        </div>
        {photoError ? <Typography as="span" className="gift-field-error" role="alert" variant="memoryMeta">{photoError}</Typography> : null}
      </div>

      {metadataStatus !== 'idle' ? <Typography aria-live="polite" as="p" className="gift-form-metadata-status" role="status" variant="memoryMeta">
        {metadataStatus === 'loading' ? 'Ищем название и фото по ссылке…' : metadataStatus === 'ready' ? 'Название и фото добавлены. Их можно изменить.' : metadataStatus === 'partial' ? 'Добавили доступные данные. Проверьте поля перед сохранением.' : 'Не удалось получить данные магазина. Можно сохранить ссылку со значком подарка и изменить название позже.'}
      </Typography> : null}

      {failure ? <Typography as="p" className="gift-form-failure" role="alert" variant="memoryCaption">{failure}</Typography> : null}

      <div className="gift-form-actions">
        <button className="gift-button gift-button--primary gift-button--wide" disabled={busy || photoChecking || !draft.canSave} type="submit">
          <Typography as="span" variant="memoryButton">{photoChecking ? 'Проверяем фото…' : busy ? saveProgress || 'Сохраняем…' : status === 'error' ? 'Повторить' : 'Сохранить'}</Typography>
        </button>
        <button className="gift-button gift-button--wide" disabled={busy} onClick={onClose} type="button">
          <Typography as="span" variant="memoryButton">Отмена</Typography>
        </button>
      </div>
    </form>
  )
}
