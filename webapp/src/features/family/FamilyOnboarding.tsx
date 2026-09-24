import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { BrandLogo } from '@/components/BrandLogo'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { resolveAvatarContentType } from '@/features/avatar'
import { ApiRequestError } from '@/platform/api'
import type { AuthenticatedTransport } from '@/platform/api'
import { completeChildProfile, updateFamily, uploadChildAvatar } from './api'
import {
  familyCalendarDate,
  formatChildAge,
  isBirthDateOnOrBeforeFamilyToday,
  onboardingSaveErrorMessage,
} from './model'
import type { FamilyResponse } from '@web-app-demo/contracts'

type Crop = { x: number; y: number; width: number; height: number }

export function FamilyOnboarding({
  familyId,
  familyTimezone,
  initialChild,
  photoOnly = false,
  transport,
  onCancel,
  onCompleted,
}: {
  familyId: string
  familyTimezone: string
  initialChild?: NonNullable<FamilyResponse['child']>
  photoOnly?: boolean
  transport: AuthenticatedTransport
  onCancel?: () => void
  onCompleted: () => Promise<void>
}) {
  const [name, setName] = useState(initialChild?.name ?? '')
  const [birthDate, setBirthDate] = useState(initialChild?.birthDate ?? '')
  const [sex, setSex] = useState<'boy' | 'girl' | null>(initialChild?.sex ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [cropPreviewUrl, setCropPreviewUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [aspect, setAspect] = useState(1)
  const [cropImageLoaded, setCropImageLoaded] = useState(false)
  const [confirmedCrop, setConfirmedCrop] = useState<Crop>(
    initialChild?.avatarCrop ?? { x: 0, y: 0, width: 1, height: 1 },
  )
  const finalizedAvatar = useRef<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [photoSaved, setPhotoSaved] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<Error | null>(null)
  const [childVersionConflict, setChildVersionConflict] = useState(false)

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => () => {
    if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl)
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
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [familyId, initialChild?.avatarMediaId, transport])

  const crop = useMemo<Crop>(() => {
    if (!cropFile) return confirmedCrop
    const width = Math.min(1, 1 / aspect) / zoom
    const height = Math.min(1, aspect) / zoom
    return { x: Math.min(Math.max(0, position.x), 1 - width), y: Math.min(Math.max(0, position.y), 1 - height), width, height }
  }, [aspect, confirmedCrop, cropFile, position, zoom])
  const age = formatChildAge(birthDate, familyTimezone)
  const maximumBirthDate = familyCalendarDate(familyTimezone)
  const displayAvatarUrl = previewUrl ?? currentAvatarUrl
  const photoVersionConflict = photoOnly && childVersionConflict
  const isChildEdit = Boolean(initialChild && !photoOnly)

  function chooseFile(next: File | null) {
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
    setCropFile(next)
    setCropPreviewUrl(URL.createObjectURL(next))
    setCropImageLoaded(false)
    setZoom(1)
    setPosition({ x: 0, y: 0 })
    setAspect(1)
    setFormErrors((errors) => ({ ...errors, avatar: '' }))
  }

  function cancelCrop() {
    setCropFile(null)
    setCropPreviewUrl(null)
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }

  function useCrop() {
    if (!cropFile) return
    setFile(cropFile)
    setPreviewUrl(URL.createObjectURL(cropFile))
    setConfirmedCrop(crop)
    finalizedAvatar.current = null
    cancelCrop()
  }

  function moveCrop(deltaX: number, deltaY: number) {
    setPosition((current) => ({
      x: Math.min(Math.max(0, current.x + deltaX), 1 - crop.width),
      y: Math.min(Math.max(0, current.y + deltaY), 1 - crop.height),
    }))
  }

  async function submit() {
    const errors: Record<string, string> = {}
    if (photoOnly) {
      if (!initialChild) errors.avatar = 'Не удалось загрузить профиль ребёнка.'
      else if (!file) errors.avatar = 'Выберите и подтвердите новую фотографию.'
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
      || (!photoOnly && ((!file && !initialChild?.avatarMediaId) || !sex || age === null))) return

    setSubmitting(true)
    try {
      const contentType = file ? resolveAvatarContentType(file) : null
      if (file && !contentType) return
      let avatarMediaId = initialChild?.avatarMediaId ?? null
      if (file && contentType) {
        avatarMediaId = finalizedAvatar.current ?? await uploadChildAvatar(transport, familyId, file, contentType)
        finalizedAvatar.current = avatarMediaId
      }
      if (!avatarMediaId) throw new Error('Не удалось подготовить фотографию ребёнка.')
      if (photoOnly) {
        if (!initialChild) throw new Error('Не удалось загрузить профиль ребёнка.')
        await updateFamily(transport, familyId, { child: {
          avatarMediaId, avatarCrop: confirmedCrop, expectedVersion: initialChild.version,
        } })
      } else {
        await completeChildProfile(transport, familyId, {
          name: name.trim(), birthDate, sex: sex!, avatarMediaId, avatarCrop: confirmedCrop,
          expectedVersion: initialChild?.version ?? null,
        })
      }
      await onCompleted()
      if (photoOnly) setPhotoSaved(true)
    } catch (error) {
      if (photoOnly && error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT') {
        finalizedAvatar.current = null
        setChildVersionConflict(true)
      }
      setRequestError(error instanceof Error ? error : new Error('Не удалось сохранить профиль ребёнка.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={`${cropPreviewUrl || photoSaved ? 'family-screen child-screen child-photo-flow-screen' : isChildEdit ? 'family-screen child-screen child-edit-v2-screen' : ''} ${cropPreviewUrl ? 'child-photo-crop-screen' : ''} mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-[calc(var(--layout-gutter)+var(--host-inset-left))] pb-[calc(var(--layout-gutter)+var(--host-inset-bottom))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))]`}>
      {cropPreviewUrl ? <div className="child-titlebar child-photo-titlebar">
        <button aria-label="Отменить кадрирование" className="family-round-btn child-back-btn" onClick={cancelCrop} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
        <Typography aria-level={1} className="child-page-title" id="child-onboarding-title" role="heading" variant="memoryScreen">Выберите фото</Typography>
        <span aria-hidden="true" className="child-title-action" />
      </div> : photoSaved ? <div className="child-titlebar child-photo-titlebar">
        <button aria-label="Вернуться в профиль ребёнка" className="family-round-btn child-back-btn" onClick={onCancel} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
        <Typography className="child-page-title" id="child-onboarding-title" variant="memoryScreen" />
        <span aria-hidden="true" className="child-title-action" />
      </div> : isChildEdit ? <div className="child-titlebar ui-topbar ds-topbar child-edit-v2-titlebar">
        <button aria-label="Назад к профилю ребёнка" className="family-round-btn ui-round-btn ds-icon-btn child-back-btn" disabled={submitting} onClick={() => onCancel?.()} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
        <Typography className="child-page-title ui-page-title ds-page-title" id="child-onboarding-title" variant="memoryScreen">Редактировать профиль</Typography>
        <span aria-hidden="true" className="child-title-action" />
      </div> : <BrandLogo className="w-[148px]" />}
      <section aria-labelledby={cropPreviewUrl || photoSaved || isChildEdit ? 'child-onboarding-title' : undefined} className={isChildEdit && !cropPreviewUrl && !photoSaved ? 'child-edit-v2-shell' : `mx-auto ${cropPreviewUrl || photoSaved ? 'w-full max-w-[452px]' : 'mt-6 w-full max-w-md'} pb-10`} data-slot={isChildEdit && !cropPreviewUrl && !photoSaved ? 'child-profile-editor' : undefined}>
        {photoSaved ? <div className="child-photo-success">
          <div aria-hidden="true" className="child-photo-success-icon"><Typography variant="memoryScreen">✓</Typography></div>
          <Typography className="child-photo-success-title" role="status" variant="memoryScreen">Фото обновлено!</Typography>
          <Typography className="child-photo-success-copy" tone="muted" variant="memoryBody">Новое фото профиля сохранено.</Typography>
          <Button className="child-photo-success-action" onClick={onCancel} type="button"><Typography variant="memoryButton">Перейти в профиль</Typography></Button>
        </div> : <>
        {!isChildEdit && !cropPreviewUrl ? <Typography id="child-onboarding-title" variant="memoryHero">{photoOnly ? 'Сменить фото ребёнка' : 'Расскажите о ребёнке'}</Typography> : null}
        {!isChildEdit && !cropPreviewUrl ? <Typography className="mt-2" tone="muted" variant="memoryBody">
          {photoOnly ? 'Выберите фотографию, настройте кадрирование и сохраните.' : 'Это поможет сделать семейную ленту вашей.'}
        </Typography> : null}

        {cropPreviewUrl ? null : isChildEdit ? <div className="child-edit-v2-intro">
          <label className="child-edit-v2-avatar-control" htmlFor="child-avatar">
            <span className="child-edit-v2-avatar">
            <span className="child-edit-v2-avatar-image">
              {displayAvatarUrl ? (
                <img
                  alt={previewUrl ? 'Предпросмотр аватара ребёнка' : 'Текущий аватар ребёнка'}
                  className="size-full object-cover"
                  src={displayAvatarUrl}
                  style={cropStyle(confirmedCrop)}
                />
              ) : <Typography variant="memoryChild">Фото</Typography>}
            </span>
            <span aria-hidden="true" className="child-edit-v2-camera"><WebpIcon decorative name="photo" size={19} /></span>
            </span>
            <Typography className="child-edit-v2-photo-link" tone="primary" variant="memoryButton">Заменить фотографию</Typography>
            <input
              aria-label="Заменить фотографию ребёнка"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="sr-only"
              id="child-avatar"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <p className="ds-meta">Изменения увидят только участники вашей семьи.</p>
        </div> : <label className="mt-7 flex cursor-pointer flex-col items-center gap-3" htmlFor="child-avatar">
          <span className="relative grid size-36 place-items-center overflow-hidden rounded-full bg-accent">
            {displayAvatarUrl ? (
              <img
                alt={previewUrl ? 'Предпросмотр аватара ребёнка' : 'Текущий аватар ребёнка'}
                className="size-full object-cover"
                src={displayAvatarUrl}
                style={cropStyle(confirmedCrop)}
              />
            ) : (
              <Typography variant="memoryChild">Фото</Typography>
            )}
          </span>
          <Typography tone="primary" variant="memoryButton">{initialChild ? 'Заменить фотографию' : 'Выбрать фотографию'}</Typography>
          <input
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            id="child-avatar"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>}
        {cropPreviewUrl ? (
          <section aria-label="Кадрирование фотографии" className="child-photo-crop-stage" data-slot="child-photo-crop">
            <div className="child-photo-crop-frame">
              <img
                alt="Предпросмотр кадрирования"
                className="child-photo-crop-image"
                onLoad={(event) => {
                  setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || 1)
                  setCropImageLoaded(true)
                }}
                src={cropPreviewUrl}
                style={cropStyle(crop)}
              />
              <span aria-hidden="true" className="crop-corner tl" />
              <span aria-hidden="true" className="crop-corner tr" />
              <span aria-hidden="true" className="crop-corner bl" />
              <span aria-hidden="true" className="crop-corner br" />
            </div>
            <label className="child-photo-zoom-control" htmlFor="avatar-crop">
              <span className="child-photo-zoom-row">
                <Typography aria-hidden="true" className="child-photo-zoom-symbol" variant="memoryMeta">−</Typography>
                <input aria-label="Масштаб кадрирования" id="avatar-crop" max="2.5" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.1" type="range" value={zoom} />
                <Typography aria-hidden="true" className="child-photo-zoom-symbol" variant="memoryMeta">+</Typography>
              </span>
            </label>
            <div aria-label="Положение фотографии" className="child-photo-position-controls" role="group">
              <Button aria-label="Сдвинуть влево" onClick={() => moveCrop(-0.05, 0)} type="button" variant="ghost"><Typography aria-hidden="true" variant="memoryMeta">←</Typography></Button>
              <Button aria-label="Сдвинуть вправо" onClick={() => moveCrop(0.05, 0)} type="button" variant="ghost"><Typography aria-hidden="true" variant="memoryMeta">→</Typography></Button>
              <Button aria-label="Сдвинуть вверх" onClick={() => moveCrop(0, -0.05)} type="button" variant="ghost"><Typography aria-hidden="true" variant="memoryMeta">↑</Typography></Button>
              <Button aria-label="Сдвинуть вниз" onClick={() => moveCrop(0, 0.05)} type="button" variant="ghost"><Typography aria-hidden="true" variant="memoryMeta">↓</Typography></Button>
            </div>
            <div className="child-photo-crop-actions">
              <Button className="child-photo-crop-primary" disabled={!cropImageLoaded} onClick={useCrop} type="button"><Typography variant="memoryButton">Использовать это фото</Typography></Button>
              <Button className="child-photo-crop-secondary" onClick={cancelCrop} type="button" variant="outline"><Typography variant="memoryButton">Отмена</Typography></Button>
            </div>
          </section>
        ) : null}
        <FieldError message={formErrors.avatar} />

        {isChildEdit && !cropPreviewUrl ? <div className="child-edit-v2-form">
          <section className="child-edit-v2-card surface-raised ds-card ds-card--standard">
            <label className="child-edit-v2-label ds-label" htmlFor="child-name">Имя ребёнка</label>
            <div className="child-edit-v2-field surface-inset">
              <WebpIcon decorative name="user" size={19} />
              <input id="child-name" maxLength={60} onChange={(event) => setName(event.target.value)} value={name} />
            </div>
            <FieldError message={formErrors.name} />
            <label className="child-edit-v2-label child-edit-v2-label--spaced ds-label" htmlFor="child-birth-date">Дата рождения</label>
            <div className="child-edit-v2-field surface-inset">
              <WebpIcon decorative name="calendar" size={19} />
              <input id="child-birth-date" max={maximumBirthDate} onChange={(event) => setBirthDate(event.target.value)} type="date" value={birthDate} />
            </div>
            {age !== null ? <div className="child-edit-v2-helper ds-meta">Сейчас {age}</div> : null}
            <FieldError message={formErrors.birthDate} />
          </section>
          <fieldset className="child-edit-v2-sex-field">
            <legend className="child-edit-v2-section-title ds-section-title">Пол ребёнка</legend>
            <div className="child-edit-v2-card surface-raised ds-card ds-card--standard">
              <div className="child-edit-v2-sex">
                <label><input checked={sex === 'girl'} name="childEditSex" onChange={() => setSex('girl')} type="radio" value="girl" /><span aria-hidden="true" className="child-edit-v2-radio" /><span className="child-edit-v2-sex-copy"><strong>Девочка</strong><small>Используется только в профиле ребёнка</small></span></label>
                <label><input checked={sex === 'boy'} name="childEditSex" onChange={() => setSex('boy')} type="radio" value="boy" /><span aria-hidden="true" className="child-edit-v2-radio" /><span className="child-edit-v2-sex-copy"><strong>Мальчик</strong><small>Используется только в профиле ребёнка</small></span></label>
              </div>
              <FieldError message={formErrors.sex} />
            </div>
          </fieldset>
        </div> : !photoOnly && !cropPreviewUrl ? <div>
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

        {requestError || photoVersionConflict ? <section className="mt-5 rounded-[var(--radius-field)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]" role="alert">
          <Typography variant="memoryBody">
            {photoVersionConflict
              ? 'Профиль ребёнка уже изменился. Отмените смену фото, вернитесь в профиль и откройте её снова.'
              : onboardingSaveErrorMessage}
          </Typography>
          {!photoVersionConflict ? <Button className="mt-3" onClick={() => void submit()} type="button" variant="ghost"><Typography variant="memoryButton">Повторить</Typography></Button> : null}
        </section> : null}
        {!cropPreviewUrl ? <Button className={isChildEdit ? 'child-edit-v2-save ui-btn ui-btn-primary ds-btn ds-btn--primary' : 'mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]'} disabled={submitting || (photoOnly && (!file || photoVersionConflict))} onClick={() => void submit()} type="button">
          <Typography variant="memoryButton">{submitting ? 'Сохраняем…' : photoOnly ? 'Сохранить фото' : initialChild ? 'Сохранить профиль' : 'Создать семейную ленту'}</Typography>
        </Button> : null}
        {onCancel && !cropPreviewUrl && !isChildEdit ? <Button className="mt-3 min-h-11 w-full" disabled={submitting} onClick={onCancel} type="button" variant="outline"><Typography variant="memoryButton">Отмена</Typography></Button> : null}
        </>}
      </section>
    </main>
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

function cropStyle(crop: Crop) {
  return {
    objectFit: 'cover' as const,
    objectPosition: `${(crop.x + crop.width / 2) * 100}% ${(crop.y + crop.height / 2) * 100}%`,
    transform: `scale(${1 / Math.min(crop.width, crop.height)})`,
  }
}
