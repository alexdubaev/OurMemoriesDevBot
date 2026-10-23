import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/BrandLogo'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { AvatarEditor, avatarCropStyle, createAvatarPreview, fullAvatarCrop, resolveAvatarContentType } from '@/features/avatar'
import type { AvatarCrop } from '@/features/avatar'
import { ApiRequestError } from '@/platform/api'
import type { AuthenticatedTransport } from '@/platform/api'
import { completeChildProfile, createChild, deleteChild, updateChild, updateFamily, uploadChildAvatar } from './api'
import {
  childActionErrorMessage,
  familyCalendarDate,
  formatChildAge,
  isBirthDateOnOrBeforeFamilyToday,
  onboardingSaveErrorMessage,
} from './model'
import type { ChildDto } from '@web-app-demo/contracts'

type Crop = AvatarCrop

export function FamilyOnboarding({
  familyId,
  familyTimezone,
  initialChild,
  addChild = false,
  canDelete = false,
  legacyProfileEndpoint = false,
  photoOnly = false,
  transport,
  onCancel,
  cancelLabel = 'Отмена',
  onCompleted,
  onDeleted,
  onRefresh,
}: {
  familyId: string
  familyTimezone: string
  initialChild?: ChildDto
  /** The owner adds one more child to a family that already has one. */
  addChild?: boolean
  /** Offers «Удалить профиль» in the editor; the server still decides whether it is allowed. */
  canDelete?: boolean
  /** Saves through `PUT /child`, the call the oldest child's profile has always used; other children use `PATCH /children/:id`. */
  legacyProfileEndpoint?: boolean
  photoOnly?: boolean
  transport: AuthenticatedTransport
  onCancel?: () => void
  cancelLabel?: string
  onCompleted: () => Promise<void>
  onDeleted?: () => Promise<void>
  /** Reloads the family after another editor changed this profile first. */
  onRefresh?: () => Promise<void>
}) {
  const [name, setName] = useState(initialChild?.name ?? '')
  const [birthDate, setBirthDate] = useState(initialChild?.birthDate ?? '')
  const [sex, setSex] = useState<'boy' | 'girl' | null>(initialChild?.sex ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)
  const [cropPreviewBlob, setCropPreviewBlob] = useState<Blob | null>(null)
  const [restoreConfirmedCrop, setRestoreConfirmedCrop] = useState(false)
  const [confirmedCrop, setConfirmedCrop] = useState<Crop>(
    initialChild?.avatarCrop ?? fullAvatarCrop,
  )
  const [cropDirty, setCropDirty] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const finalizedAvatar = useRef<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [photoSaved, setPhotoSaved] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<Error | null>(null)
  const submitError = useRef<Error | null>(null)
  const [childVersionConflict, setChildVersionConflict] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const submitLock = useRef(false)
  const createAttempt = useRef<{ key: string; payload: string } | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const previewController = useRef<AbortController | null>(null)
  const ownedCropUrls = useRef(new Set<string>())

  const requestCancel = () => {
    const unsaved = !photoSaved && (name !== (initialChild?.name ?? '') || birthDate !== (initialChild?.birthDate ?? '') || sex !== (initialChild?.sex ?? null) || file !== null || cropFile !== null || cropDirty)
    if (unsaved && typeof window.confirm === 'function' && !window.confirm('Удалить несохранённые изменения?')) return
    onCancel?.()
  }

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => () => {
    previewController.current?.abort()
    if (cropPreviewUrl && ownedCropUrls.current.delete(cropPreviewUrl)) URL.revokeObjectURL(cropPreviewUrl)
  }, [cropPreviewUrl])

  useEffect(() => {
    if (!initialChild?.avatarMediaId) return
    let cancelled = false
    let objectUrl: string | null = null
    void transport.raw(
      `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(initialChild.avatarMediaId)}/content?variant=display`,
    ).then(async (response) => {
      if (!response.ok) return
      objectUrl = URL.createObjectURL(await response.blob())
      if (!cancelled) setCurrentAvatarUrl(objectUrl)
      else URL.revokeObjectURL(objectUrl)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, initialChild?.avatarMediaId, transport])

  const age = formatChildAge(birthDate, familyTimezone)
  const maximumBirthDate = familyCalendarDate(familyTimezone)
  const displayAvatarUrl = previewUrl ?? currentAvatarUrl
  const photoVersionConflict = photoOnly && childVersionConflict
  const isChildEdit = Boolean(initialChild && !photoOnly)
  const editVersionConflict = !photoOnly && childVersionConflict
  const refusalMessage = (error: Error | null) => initialChild || addChild ? childActionErrorMessage(error) : onboardingSaveErrorMessage

  async function chooseFile(next: File | null) {
    setRequestError(null)
    if (!next) {
      setCropFile(null)
      setCropPreviewUrl(null)
      return
    }
    const contentType = resolveAvatarContentType(next)
    if (!contentType || next.size < 64 || next.size > 20_000_000) {
      setFormErrors((errors) => ({ ...errors, avatar: 'Выберите фотографию до 20 МБ в формате JPEG, PNG, WebP или HEIC.' }))
      return
    }
    finalizedAvatar.current = null
    setRestoreConfirmedCrop(false)
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setPreviewing(true)
    try {
      const normalized = contentType === 'image/heic' || contentType === 'image/heif'
        ? await createAvatarPreview(transport, next, contentType, controller.signal)
        : next
      if (controller.signal.aborted) return
      setCropFile(next)
      const blob = normalized instanceof Blob ? normalized : new Blob([normalized])
      const url = URL.createObjectURL(blob)
      ownedCropUrls.current.add(url)
      setCropPreviewBlob(blob)
      setCropPreviewUrl(url)
    } catch (error) {
      if (controller.signal.aborted) return
      setRequestError(error instanceof Error ? error : new Error('Не удалось открыть фотографию. Выберите другое фото.'))
      return
    } finally { if (previewController.current === controller) { previewController.current = null; setPreviewing(false) } }
    setFormErrors((errors) => ({ ...errors, avatar: '' }))
  }

  function cancelCrop() {
    setCropFile(null)
    setCropPreviewBlob(null)
    setCropPreviewUrl(null)
  }

  function openDisplayedAvatarCrop() {
    if (file && previewUrl) {
      setCropFile(file)
      setCropPreviewBlob(null)
      setRestoreConfirmedCrop(true)
      setCropPreviewUrl(previewUrl)
      return
    }
    if (currentAvatarUrl) {
      setCropFile(null)
      setCropPreviewBlob(null)
      setRestoreConfirmedCrop(true)
      setCropPreviewUrl(currentAvatarUrl)
    }
  }

  async function useCrop(crop: Crop) {
    if (photoOnly) {
      submitError.current = null
      const saved = await submit({ file: cropFile, crop })
      if (!saved) {
        const error = submitError.current as Error | null
        throw new Error(error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT'
          ? 'Профиль ребёнка уже изменился. Отмените редактор и откройте его снова.'
          : error?.message ?? 'Не удалось сохранить фото. Проверьте соединение и повторите попытку.')
      }
      setFile(cropFile)
      if (cropFile && cropPreviewBlob) setPreviewUrl(URL.createObjectURL(cropPreviewBlob))
    }
    else {
      setFile(cropFile)
      if (cropFile && cropPreviewBlob) setPreviewUrl(URL.createObjectURL(cropPreviewBlob))
    }
    setConfirmedCrop(crop)
    setCropDirty(true)
    cancelCrop()
  }

  async function submit(override?: { file: File | null; crop: Crop }): Promise<boolean> {
    if (submitLock.current) return false
    const submittedFile = override ? override.file : file
    const submittedCrop = override?.crop ?? confirmedCrop
    const errors: Record<string, string> = {}
    if (photoOnly) {
      if (!initialChild) errors.avatar = 'Не удалось загрузить профиль ребёнка.'
      else if (!submittedFile && !initialChild.avatarMediaId) errors.avatar = 'Добавьте фотографию ребёнка.'
    } else {
      if (!file && !initialChild?.avatarMediaId) errors.avatar = 'Добавьте фотографию ребёнка.'
      if (!name.trim()) errors.name = 'Укажите имя ребёнка.'
      if (!birthDate || age === null || !isBirthDateOnOrBeforeFamilyToday(birthDate, familyTimezone)) {
        errors.birthDate = 'Укажите корректную дату рождения.'
      }
      if (!sex) errors.sex = 'Выберите вариант.'
    }
    setFormErrors(errors)
    setRequestError(null)
    if (Object.keys(errors).length > 0
      || (!photoOnly && ((!submittedFile && !initialChild?.avatarMediaId) || !sex || age === null))) return false

    submitLock.current = true
    setSubmitting(true)
    try {
      const contentType = submittedFile ? resolveAvatarContentType(submittedFile) : null
      if (submittedFile && !contentType) return false
      let avatarMediaId = initialChild?.avatarMediaId ?? null
      if (submittedFile && contentType) {
        avatarMediaId = finalizedAvatar.current ?? await uploadChildAvatar(transport, familyId, submittedFile, contentType)
        finalizedAvatar.current = avatarMediaId
      }
      if (!avatarMediaId) throw new Error('Не удалось подготовить фотографию ребёнка.')
      if (photoOnly) {
        if (!initialChild) throw new Error('Не удалось загрузить профиль ребёнка.')
        await updateFamily(transport, familyId, { child: {
          avatarMediaId, avatarCrop: submittedCrop, expectedVersion: initialChild.version,
        } })
      } else if (addChild) {
        const input = { name: name.trim(), birthDate, sex: sex!, avatarMediaId, avatarCrop: submittedCrop }
        // One key per distinct payload: a retry or double tap returns the same child instead of a second one.
        const payload = JSON.stringify(input)
        if (createAttempt.current?.payload !== payload) createAttempt.current = { key: crypto.randomUUID(), payload }
        await createChild(transport, familyId, input, createAttempt.current.key)
      } else if (initialChild && !legacyProfileEndpoint) {
        const avatarChanged = Boolean(file) || cropDirty
        await updateChild(transport, familyId, initialChild.id, {
          name: name.trim(), birthDate, sex: sex!,
          ...(avatarChanged ? { avatarMediaId, avatarCrop: submittedCrop } : {}),
          expectedVersion: initialChild.version,
        })
      } else {
        await completeChildProfile(transport, familyId, {
          name: name.trim(), birthDate, sex: sex!, avatarMediaId, avatarCrop: submittedCrop,
          expectedVersion: initialChild?.version ?? null,
        })
      }
      await onCompleted()
      if (photoOnly) setPhotoSaved(true)
      return true
    } catch (error) {
      submitError.current = error instanceof Error ? error : new Error('Не удалось сохранить профиль ребёнка.')
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT' && (photoOnly || initialChild)) {
        finalizedAvatar.current = null
        setChildVersionConflict(true)
      }
      setRequestError(error instanceof Error ? error : new Error('Не удалось сохранить профиль ребёнка.'))
      return false
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  async function removeChild() {
    if (!initialChild || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteChild(transport, familyId, initialChild.id, initialChild.version)
      await (onDeleted ?? onCompleted)()
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') setChildVersionConflict(true)
      setDeleteError(childActionErrorMessage(error))
      setConfirmingDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  async function refreshAfterConflict() {
    try { await onRefresh?.() } catch { /* the family screen reports a failed reload itself */ }
    onCancel?.()
  }

  return (
    <>
    <main hidden={Boolean(cropPreviewUrl)} className={`${cropPreviewUrl ? 'family-screen child-screen child-edit-v2-screen child-photo-v2-screen' : photoSaved ? 'family-screen child-screen child-photo-saved-v2-screen' : isChildEdit ? 'family-screen child-screen child-edit-v2-screen' : ''} mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-[calc(var(--layout-gutter)+var(--host-inset-left))] pb-[calc(var(--layout-gutter)+var(--host-inset-bottom))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))]`}>
      {photoSaved ? null : isChildEdit ? <div className="child-titlebar ui-topbar ds-topbar child-edit-v2-titlebar">
        <button aria-label="Назад к семье" className="family-round-btn ui-round-btn ds-icon-btn child-back-btn" disabled={submitting} onClick={requestCancel} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
        <Typography className="child-page-title ui-page-title ds-page-title" id="child-onboarding-title" variant="memoryScreen">Редактировать профиль</Typography>
        <span aria-hidden="true" className="child-title-action" />
      </div> : <BrandLogo className="w-[148px]" />}
      <section aria-labelledby={photoSaved || isChildEdit ? 'child-onboarding-title' : undefined} className={photoSaved ? 'child-shell' : isChildEdit ? 'child-edit-v2-shell' : 'mx-auto mt-6 w-full max-w-md pb-10'} data-slot={isChildEdit && !photoSaved ? 'child-profile-editor' : undefined}>
        {photoSaved ? <div className="child-titlebar ui-topbar ds-topbar">
          <button aria-label="Вернуться в профиль ребёнка" className="family-round-btn ui-round-btn ds-icon-btn child-back-btn" onClick={requestCancel} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
          <Typography className="child-page-title ui-page-title ds-page-title" id="child-onboarding-title" variant="memoryScreen" />
          <span aria-hidden="true" className="child-title-action" />
        </div> : null}
        {photoSaved ? <div className="child-success">
          <div aria-hidden="true" className="child-success-icon ui-success-mark"><Typography as="span" className="child-photo-v2-check" variant="memoryMeta">✓</Typography></div>
          <Typography as="h2" className="ds-entity-title" role="status" variant="memoryEmptyTitle">Фото обновлено!</Typography>
          <Typography as="p" variant="memoryBody">Новое фото профиля сохранено.</Typography>
          <Button className="child-primary ui-btn ui-btn-primary ds-btn ds-btn--primary" onClick={requestCancel} type="button">Перейти в профиль</Button>
        </div> : <>
        {!isChildEdit ? <Typography id="child-onboarding-title" variant="memoryHero">{photoOnly ? 'Сменить фото ребёнка' : addChild ? 'Добавить ребёнка' : 'Расскажите о ребёнке'}</Typography> : null}
        {!isChildEdit ? <Typography className="mt-2" tone="muted" variant="memoryBody">
          {photoOnly ? 'Выберите фотографию, настройте кадрирование и сохраните.' : addChild ? 'Имя, дата рождения, пол и фотография — как у первого ребёнка.' : 'Это поможет сделать семейную ленту вашей.'}
        </Typography> : null}

        {isChildEdit ? <div className="child-edit-v2-intro">
          <label className="child-edit-v2-avatar-control" htmlFor="child-avatar">
            <span className="child-edit-v2-avatar">
            <span className="child-edit-v2-avatar-image relative overflow-hidden">
              {displayAvatarUrl ? (
                <img
                  alt={previewUrl ? 'Предпросмотр аватара ребёнка' : 'Текущий аватар ребёнка'}
                  className="size-full object-cover"
                  src={displayAvatarUrl}
                  style={avatarCropStyle(confirmedCrop)}
                />
              ) : <Typography variant="memoryChild">Фото</Typography>}
            </span>
            </span>
            <Typography className="child-edit-v2-photo-link" tone="primary" variant="memoryButton">Заменить фотографию</Typography>
            <input
              aria-label="Заменить фотографию ребёнка"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              data-testid="child-avatar-file"
              id="child-avatar"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              ref={filePicker}
              type="file"
            />
          </label>
          {displayAvatarUrl ? <Button className="child-edit-v2-crop-link" onClick={openDisplayedAvatarCrop} type="button" variant="ghost">Изменить кадрирование</Button> : null}
          <Typography as="p" className="ds-meta" variant="memoryMeta">Изменения увидят только участники вашей семьи.</Typography>
        </div> : <label className="mt-7 flex cursor-pointer flex-col items-center gap-3" htmlFor="child-avatar">
          <span className="relative grid size-36 place-items-center overflow-hidden rounded-full bg-accent">
            {displayAvatarUrl ? (
              <img
                alt={previewUrl ? 'Предпросмотр аватара ребёнка' : 'Текущий аватар ребёнка'}
                className="size-full object-cover"
                src={displayAvatarUrl}
                style={avatarCropStyle(confirmedCrop)}
              />
            ) : (
              <Typography variant="memoryChild">Фото</Typography>
            )}
          </span>
          <Typography tone="primary" variant="memoryButton">{initialChild ? 'Заменить фотографию' : 'Выбрать фотографию'}</Typography>
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            data-testid="child-avatar-file"
            id="child-avatar"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            ref={filePicker}
            type="file"
          />
        </label>}
        {photoOnly && displayAvatarUrl ? <Button className="mt-3" onClick={openDisplayedAvatarCrop} type="button" variant="outline">Изменить кадрирование</Button> : null}
        <FieldError message={formErrors.avatar} />

        {isChildEdit ? <div className="child-edit-v2-form">
          <section className="child-edit-v2-card surface-raised ds-card ds-card--standard">
            <label className="child-edit-v2-label ds-label" htmlFor="child-name"><Typography as="span" style={{ font: 'inherit' }} variant="label">Имя ребёнка</Typography></label>
            <div className="child-edit-v2-field surface-inset">
              <WebpIcon decorative name="user" size={19} />
              <input id="child-name" maxLength={60} onChange={(event) => setName(event.target.value)} value={name} />
            </div>
            <FieldError message={formErrors.name} />
            <label className="child-edit-v2-label child-edit-v2-label--spaced ds-label" htmlFor="child-birth-date"><Typography as="span" style={{ font: 'inherit' }} variant="label">Дата рождения</Typography></label>
            <div className="child-edit-v2-field surface-inset">
              <WebpIcon decorative name="calendar" size={19} />
              <input id="child-birth-date" max={maximumBirthDate} onChange={(event) => setBirthDate(event.target.value)} type="date" value={birthDate} />
            </div>
            {age !== null ? <div className="child-edit-v2-helper ds-meta"><Typography as="span" style={{ font: 'inherit' }} variant="memoryMeta">Сейчас {age}</Typography></div> : null}
            <FieldError message={formErrors.birthDate} />
          </section>
          <fieldset className="child-edit-v2-sex-field">
            <legend className="child-edit-v2-section-title ds-section-title"><Typography as="span" style={{ font: 'inherit' }} variant="memoryBody">Пол ребёнка</Typography></legend>
            <div className="child-edit-v2-card surface-raised ds-card ds-card--standard">
              <div className="child-edit-v2-sex">
                <label><input checked={sex === 'girl'} name="childEditSex" onChange={() => setSex('girl')} type="radio" value="girl" /><span aria-hidden="true" className="child-edit-v2-radio" /><span className="child-edit-v2-sex-copy"><Typography as="strong" variant="memoryChild">Девочка</Typography><Typography as="small" variant="memoryMeta">Используется только в профиле ребёнка</Typography></span></label>
                <label><input checked={sex === 'boy'} name="childEditSex" onChange={() => setSex('boy')} type="radio" value="boy" /><span aria-hidden="true" className="child-edit-v2-radio" /><span className="child-edit-v2-sex-copy"><Typography as="strong" variant="memoryChild">Мальчик</Typography><Typography as="small" variant="memoryMeta">Используется только в профиле ребёнка</Typography></span></label>
              </div>
              <FieldError message={formErrors.sex} />
            </div>
          </fieldset>
        </div> : !photoOnly ? <div>
          <div className="mt-6">
            <label className="flex flex-col gap-2" htmlFor="child-name">
              <Typography variant="memoryBody">Имя ребёнка</Typography>
              <input
                className="min-h-12 rounded-[var(--radius-field)] border bg-card px-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                id="child-name"
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="Например, Маша"
                value={name}
              />
            </label>
            <FieldError message={formErrors.name} />
          </div>

          <div className="mt-5">
            <label className="flex flex-col gap-2" htmlFor="child-birth-date">
              <Typography variant="memoryBody">Дата рождения</Typography>
              <input
                className="min-h-12 rounded-[var(--radius-field)] border bg-card px-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                id="child-birth-date"
                max={maximumBirthDate}
                onChange={(event) => setBirthDate(event.target.value)}
                type="date"
                value={birthDate}
              />
              {age !== null ? <Typography tone="muted" variant="memoryMeta">Сейчас {age}</Typography> : null}
            </label>
            <FieldError message={formErrors.birthDate} />
          </div>

          <fieldset className="mt-5">
            <legend><Typography variant="memoryBody">Пол</Typography></legend>
            <div className="mt-2 grid grid-cols-2 gap-2" role="group">
              <Segment active={sex === 'boy'} label="Мальчик" onClick={() => setSex('boy')} />
              <Segment active={sex === 'girl'} label="Девочка" onClick={() => setSex('girl')} />
            </div>
            <FieldError message={formErrors.sex} />
          </fieldset>
        </div> : null}

        {requestError || photoVersionConflict || editVersionConflict ? <section className="mt-5 rounded-[var(--radius-field)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" data-slot="child-save-error" role="alert">
          <Typography variant="memoryBody">
            {photoVersionConflict
              ? 'Профиль ребёнка уже изменился. Отмените смену фото, вернитесь в профиль и откройте её снова.'
              : editVersionConflict
                ? 'Профиль ребёнка уже изменили. Обновите данные, чтобы увидеть свежую версию.'
                : refusalMessage(requestError)}
          </Typography>
          {editVersionConflict ? <Button className="mt-3" onClick={() => void refreshAfterConflict()} type="button" variant="ghost"><Typography variant="memoryButton">Обновить</Typography></Button> : null}
          {!photoVersionConflict && !editVersionConflict ? <Button className="mt-3" onClick={() => void submit()} type="button" variant="ghost"><Typography variant="memoryButton">Повторить</Typography></Button> : null}
        </section> : null}
        <Button className={isChildEdit ? 'child-edit-v2-save ui-btn ui-btn-primary ds-btn ds-btn--primary' : 'mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]'} disabled={submitting || deleting || editVersionConflict || (photoOnly && (!(file || cropDirty) || photoVersionConflict))} onClick={() => void submit()} type="button">
          <Typography variant="memoryButton">{submitting ? 'Сохраняем…' : photoOnly ? 'Сохранить фото' : addChild ? 'Сохранить' : initialChild ? 'Сохранить профиль' : 'Создать семейную ленту'}</Typography>
        </Button>
        {isChildEdit && canDelete ? <section className="child-edit-v2-delete" data-slot="child-delete">
          {deleteError ? <Typography as="p" className="child-edit-v2-delete-error" role="alert" tone="destructive" variant="memoryMeta">{deleteError}</Typography> : null}
          {confirmingDelete ? <div aria-label="Удалить профиль ребёнка" className="child-edit-v2-delete-confirm" role="group">
            <Typography as="p" variant="memoryBody">Удалить профиль «{initialChild?.name}»? Удалить можно только профиль без отметок в публикациях и без альбомов.</Typography>
            <div className="child-edit-v2-delete-actions">
              <Button disabled={deleting} onClick={() => void removeChild()} type="button" variant="destructive"><Typography variant="memoryButton">{deleting ? 'Удаляем…' : 'Удалить'}</Typography></Button>
              <Button disabled={deleting} onClick={() => setConfirmingDelete(false)} type="button" variant="ghost"><Typography variant="memoryButton">Отмена</Typography></Button>
            </div>
          </div> : <Button className="child-edit-v2-delete-link" disabled={submitting} onClick={() => { setDeleteError(null); setConfirmingDelete(true) }} type="button" variant="ghost"><Typography tone="destructive" variant="memoryButton">Удалить профиль</Typography></Button>}
        </section> : null}
        {onCancel && !isChildEdit ? <Button className="mt-3 min-h-11 w-full" disabled={submitting} onClick={requestCancel} type="button" variant="outline"><Typography variant="memoryButton">{cancelLabel}</Typography></Button> : null}
        </>}
      </section>
    </main>
    {cropPreviewUrl ? <AvatarEditor key={cropPreviewUrl} busy={submitting || previewing} canConfirm={!childVersionConflict} image={cropPreviewUrl} initialCrop={cropFile && !restoreConfirmedCrop ? fullAvatarCrop : confirmedCrop}
      onCancel={cancelCrop} onConfirm={useCrop} onChooseAnother={() => filePicker.current?.click()} /> : null}
    </>
  )
}

function Segment({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button aria-pressed={active} className={active
      ? 'min-h-12 rounded-[var(--radius-field)] bg-accent text-accent-foreground'
      : 'min-h-12 rounded-[var(--radius-field)] bg-card text-muted-foreground'} onClick={onClick} type="button">
      <Typography variant="memoryButton">{label}</Typography>
    </button>
  )
}

function FieldError({ message }: { message?: string }) {
  return message ? <Typography className="mt-1 text-destructive" role="alert" variant="memoryMeta">{message}</Typography> : null
}
