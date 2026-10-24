import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { CreateGiftRequest, GiftDto, UpdateGiftRequest } from '@web-app-demo/contracts'

import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { createIdempotencyKey, validateSize, verifyComposerFile } from '@/features/composer'
import { uploadFamilyPhoto } from '@/features/family'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'

import { createGift, giftPhotoPath, updateGift } from './api'
import { giftFailureMessage, isGiftStateConflict, photoErrorMessage, validateGiftDraft } from './model'

type PhotoContentType = Parameters<typeof uploadFamilyPhoto>[3]

type PickedPhoto = {
  file: File
  contentType: PhotoContentType
  previewUrl: string
  /** Set once the file reached storage, so a retry does not upload it again. */
  mediaId: string | null
  key: string
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
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [failure, setFailure] = useState<string | null>(null)
  const saving = useRef(false)
  const controller = useRef<AbortController | null>(null)
  // Same body => same key, so repeating a request that actually reached the server cannot make a second gift.
  const attempt = useRef<{ key: string; signature: string } | null>(null)
  const previewToRevoke = useRef<string | null>(null)

  useEffect(() => () => {
    controller.current?.abort()
    if (previewToRevoke.current) URL.revokeObjectURL(previewToRevoke.current)
  }, [])

  const currentPhotoUrl = usePrivateImageUrl(
    accountId,
    editing ? giftPhotoPath(familyId, editing.photoMediaId) : null,
    transport,
    Boolean(editing) && !photo,
    undefined,
    scopeKey,
  )
  const draft = validateGiftDraft({ url, title, price, hasPhoto: Boolean(photo) || Boolean(editing) })
  const busy = status === 'saving'

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busy) return
    const media = await verifyComposerFile(file)
    if (!media || media.kind !== 'photo') { setPhotoError(photoErrorMessage('unsupported_format')); return }
    const size = validateSize(file, media)
    if (!size.ok) { setPhotoError(photoErrorMessage(size.code)); return }
    if (previewToRevoke.current) URL.revokeObjectURL(previewToRevoke.current)
    const previewUrl = URL.createObjectURL(file)
    previewToRevoke.current = previewUrl
    setPhoto({ file, contentType: media.contentType as PhotoContentType, previewUrl, mediaId: null, key: createIdempotencyKey() })
    setPhotoError(null)
    setFailure(null)
  }

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (saving.current || !draft.canSave) return
    saving.current = true
    onBusyChange(true)
    setStatus('saving')
    setFailure(null)
    const abort = new AbortController()
    controller.current = abort
    let stage: 'upload' | 'save' = 'save'
    try {
      let photoMediaId = photo?.mediaId ?? null
      if (photo && !photoMediaId) {
        stage = 'upload'
        photoMediaId = await uploadFamilyPhoto(transport, familyId, photo.file, photo.contentType, 'gift', abort.signal, undefined, photo.key)
        const uploaded = photoMediaId
        setPhoto((current) => (current && current.key === photo.key ? { ...current, mediaId: uploaded } : current))
        stage = 'save'
      }
      const cleanTitle = title.trim()
      const cleanUrl = url.trim()
      const cleanPrice = price.trim()
      if (!editing) {
        const body: CreateGiftRequest = {
          title: cleanTitle, url: cleanUrl, ...(cleanPrice ? { price: cleanPrice } : {}), photoMediaId: photoMediaId!,
        }
        const signature = JSON.stringify(body)
        if (attempt.current?.signature !== signature) attempt.current = { key: createIdempotencyKey(), signature }
        const { gift } = await createGift(transport, familyId, body, attempt.current.key, abort.signal)
        onSaved(gift)
        return
      }
      const patch: UpdateGiftRequest = { expectedVersion: editing.version }
      if (cleanTitle !== editing.title) patch.title = cleanTitle
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
        setPhoto((current) => (current?.mediaId ? { ...current, mediaId: null, key: createIdempotencyKey() } : current))
      }
      setStatus('error')
      setFailure(stage === 'upload' && !(error instanceof ApiRequestError)
        ? 'Не удалось загрузить фото. Проверьте соединение и повторите.'
        : giftFailureMessage(error))
    } finally {
      saving.current = false
      onBusyChange(false)
      setStatus((current) => (current === 'saving' ? 'idle' : current))
    }
  }

  const previewUrl = photo?.previewUrl ?? currentPhotoUrl
  return (
    <form className="gift-form" data-slot="gift-form" onSubmit={(event) => void save(event)}>
      <DrawerTitle className="gift-form-title">{editing ? 'Изменить подарок' : 'Новый подарок'}</DrawerTitle>
      <DrawerDescription className="gift-form-subtitle">Ссылка на товар, название и фото обязательны</DrawerDescription>

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
          onChange={(event) => setUrl(event.target.value)}
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
          onChange={(event) => setTitle(event.target.value)}
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
          onChange={(event) => setPrice(event.target.value)}
          placeholder="Например, около 3000 ₽"
          type="text"
          value={price}
        />
        {draft.errors.price ? <Typography as="span" className="gift-field-error" id={`${ids.price}-error`} role="alert" variant="memoryMeta">{draft.errors.price}</Typography> : null}
      </div>

      <div className="gift-field">
        <Typography as="span" className="gift-field-label" variant="memoryMeta">Фото</Typography>
        <div className="gift-photo-picker">
          <span aria-hidden="true" className="gift-photo-preview">
            {previewUrl ? <img alt="" draggable={false} src={previewUrl} /> : <WebpIcon decorative monochrome name="photo" size={28} />}
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

      {failure ? <Typography as="p" className="gift-form-failure" role="alert" variant="memoryCaption">{failure}</Typography> : null}

      <div className="gift-form-actions">
        <button className="gift-button gift-button--primary gift-button--wide" disabled={busy || !draft.canSave} type="submit">
          <Typography as="span" variant="memoryButton">{busy ? 'Сохраняем…' : status === 'error' ? 'Повторить' : 'Сохранить'}</Typography>
        </button>
        <button className="gift-button gift-button--wide" disabled={busy} onClick={onClose} type="button">
          <Typography as="span" variant="memoryButton">Отмена</Typography>
        </button>
      </div>
    </form>
  )
}
