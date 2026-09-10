import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { InlineError } from '@/features/feed'
import { resolveAvatarContentType } from '@/features/avatar'
import type { AuthenticatedTransport } from '@/platform/api'
import { completeChildProfile, uploadChildAvatar } from './api'
import { ageFromBirthDate } from './model'
import type { FamilyResponse } from '@web-app-demo/contracts'

type Crop = { x: number; y: number; width: number; height: number }

export function FamilyOnboarding({
  familyId,
  initialChild,
  transport,
  onCompleted,
}: {
  familyId: string
  initialChild?: NonNullable<FamilyResponse['child']>
  transport: AuthenticatedTransport
  onCompleted: () => Promise<void>
}) {
  const [name, setName] = useState(initialChild?.name ?? '')
  const [birthDate, setBirthDate] = useState(initialChild?.birthDate ?? '')
  const [sex, setSex] = useState<'boy' | 'girl' | null>(initialChild?.sex ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: initialChild?.avatarCrop?.x ?? 0, y: initialChild?.avatarCrop?.y ?? 0 })
  const [aspect, setAspect] = useState(1)
  const finalizedAvatar = useRef<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [requestError, setRequestError] = useState<Error | null>(null)

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const crop = useMemo<Crop>(() => {
    if (!file && initialChild?.avatarCrop) return initialChild.avatarCrop
    const width = Math.min(1, 1 / aspect) / zoom
    const height = Math.min(1, aspect) / zoom
    return { x: Math.min(Math.max(0, position.x), 1 - width), y: Math.min(Math.max(0, position.y), 1 - height), width, height }
  }, [aspect, file, initialChild?.avatarCrop, position, zoom])
  const age = ageFromBirthDate(birthDate)

  function chooseFile(next: File | null) {
    setRequestError(null)
    if (!next) {
      setFile(null)
      setPreviewUrl(null)
      return
    }
    const contentType = resolveAvatarContentType(next)
    if (!contentType || next.size < 64 || next.size > 20_000_000) {
      setFormErrors((errors) => ({ ...errors, avatar: 'Выберите фотографию до 20 МБ в формате JPEG, PNG, WebP или HEIC.' }))
      return
    }
    setFile(next)
    finalizedAvatar.current = null
    setPreviewUrl(URL.createObjectURL(next))
    setFormErrors((errors) => ({ ...errors, avatar: '' }))
  }

  async function submit() {
    const errors: Record<string, string> = {}
    if (!file && !initialChild?.avatarMediaId) errors.avatar = 'Добавьте фотографию ребёнка.'
    if (!name.trim()) errors.name = 'Укажите имя ребёнка.'
    if (!birthDate || age === null) errors.birthDate = 'Укажите корректную дату рождения.'
    if (!sex) errors.sex = 'Выберите вариант.'
    setFormErrors(errors)
    setRequestError(null)
    if (Object.keys(errors).length > 0 || (!file && !initialChild?.avatarMediaId) || !sex || age === null) return

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
      await completeChildProfile(transport, familyId, {
        name: name.trim(), birthDate, sex, avatarMediaId, avatarCrop: crop, expectedVersion: initialChild?.version ?? null,
      })
      await onCompleted()
    } catch (error) {
      setRequestError(error instanceof Error ? error : new Error('Не удалось сохранить профиль ребёнка.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen min-h-dvh max-w-[var(--layout-max-width)] flex-col px-[calc(var(--layout-gutter)+var(--host-inset-left))] pb-[calc(var(--layout-gutter)+var(--host-inset-bottom))] pt-[calc(var(--layout-gutter)+var(--host-inset-top))] pr-[calc(var(--layout-gutter)+var(--host-inset-right))]">
      <Typography variant="memoryScreen">Наши воспоминания</Typography>
      <section aria-labelledby="child-onboarding-title" className="mx-auto mt-6 w-full max-w-md pb-10">
        <Typography id="child-onboarding-title" variant="memoryHero">{initialChild ? 'Профиль ребёнка' : 'Расскажите о ребёнке'}</Typography>
        <Typography className="mt-2" tone="muted" variant="memoryBody">
          {initialChild ? 'Изменения увидят только участники вашей семьи.' : 'Это поможет сделать семейную ленту вашей.'}
        </Typography>

        <label className="mt-7 flex cursor-pointer flex-col items-center gap-3" htmlFor="child-avatar">
          <span className="relative grid size-36 place-items-center overflow-hidden rounded-full bg-accent">
            {previewUrl ? (
              <img
                alt="Предпросмотр аватара ребёнка"
                className="size-full object-cover"
                src={previewUrl}
                onLoad={(event) => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight || 1)}
                style={{ objectFit: 'cover', objectPosition: `${(crop.x + crop.width / 2) * 100}% ${(crop.y + crop.height / 2) * 100}%`, transform: `scale(${zoom})` }}
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
        </label>
        {previewUrl ? (
          <label className="mt-3 flex flex-col gap-1" htmlFor="avatar-crop">
            <Typography tone="muted" variant="memoryMeta">Кадрирование</Typography>
            <input id="avatar-crop" max="2.5" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.1" type="range" value={zoom} />
            <div className="grid grid-cols-2 gap-2"><Button onClick={() => setPosition({ x: Math.max(0, crop.x - 0.05), y: crop.y })} type="button" variant="ghost"><Typography variant="memoryMeta">Сдвинуть влево</Typography></Button><Button onClick={() => setPosition({ x: Math.min(1 - crop.width, crop.x + 0.05), y: crop.y })} type="button" variant="ghost"><Typography variant="memoryMeta">Сдвинуть вправо</Typography></Button></div>
          </label>
        ) : null}
        <FieldError message={formErrors.avatar} />

        <label className="mt-6 flex flex-col gap-2" htmlFor="child-name">
          <Typography variant="memoryBody">Имя</Typography>
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

        <label className="mt-5 flex flex-col gap-2" htmlFor="child-birth-date">
          <Typography variant="memoryBody">Дата рождения</Typography>
          <input
            className="min-h-12 rounded-[var(--radius-field)] border bg-card px-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
            id="child-birth-date"
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setBirthDate(event.target.value)}
            type="date"
            value={birthDate}
          />
          {age !== null ? <Typography tone="muted" variant="memoryMeta">Сейчас {age} {ageWord(age)}</Typography> : null}
        </label>
        <FieldError message={formErrors.birthDate} />

        <fieldset className="mt-5">
          <legend><Typography variant="memoryBody">Пол</Typography></legend>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group">
            <Segment active={sex === 'boy'} label="Мальчик" onClick={() => setSex('boy')} />
            <Segment active={sex === 'girl'} label="Девочка" onClick={() => setSex('girl')} />
          </div>
        </fieldset>
        <FieldError message={formErrors.sex} />

        {requestError ? <div className="mt-5"><InlineError onRetry={() => void submit()} /></div> : null}
        <Button className="mt-7 min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]" disabled={submitting} onClick={() => void submit()} type="button">
          <Typography variant="memoryButton">{submitting ? 'Сохраняем…' : initialChild ? 'Сохранить профиль' : 'Создать семейную ленту'}</Typography>
        </Button>
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

function ageWord(age: number) {
  if (age % 10 === 1 && age % 100 !== 11) return 'год'
  if (age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14)) return 'года'
  return 'лет'
}
