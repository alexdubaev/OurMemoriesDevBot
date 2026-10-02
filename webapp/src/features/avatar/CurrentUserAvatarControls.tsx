import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { AvatarEditor } from './AvatarEditor'
import { AvatarPhoto } from './AvatarPhoto'
import { fullAvatarCrop } from './avatar-crop'
import { useAvatarQuery, useDeleteAvatarMutation, useUpdateAvatarCropMutation, useUploadAvatarMutation } from './queries'
import type { AvatarCrop } from './avatar-crop'
import { useAuth } from '@/features/auth'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { createAvatarPreview } from './api'
import { resolveAvatarContentType } from './upload'

export function CurrentUserAvatarControls({ displayName, email, compact = false }: { displayName: string | null; email?: string | null; compact?: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const previewController = useRef<AbortController | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [editorImage, setEditorImage] = useState<string | null>(null)
  const [editingReplacement, setEditingReplacement] = useState(false)
  const [editTarget, setEditTarget] = useState<{ id: string; updatedAt: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const auth = useAuth()
  const avatarQuery = useAvatarQuery()
  const upload = useUploadAvatarMutation()
  const updateCrop = useUpdateAvatarCropMutation()
  const remove = useDeleteAvatarMutation()
  const avatar = avatarQuery.data?.avatar
  const imagePath = avatar?.id ? `/api/uploads/avatar/content?avatar=${encodeURIComponent(avatar.id)}&v=${encodeURIComponent(avatar.updatedAt ?? '')}` : null
  const imageUrl = usePrivateImageUrl(auth.user?.id ?? '', imagePath, auth.transport, Boolean(auth.user?.id && imagePath))
  const busy = previewing || upload.isPending || updateCrop.isPending || remove.isPending

  useEffect(() => () => { previewController.current?.abort(); if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const type = resolveAvatarContentType(file)
    if (!type || file.size < 64 || file.size > 5 * 1024 * 1024) {
      setPreviewError('Выберите фото JPEG, PNG, WebP, HEIC или HEIF размером до 5 МБ.')
      return
    }
    setPreviewError(null)
    setPreviewing(true)
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    try {
      const next = type === 'image/heic' || type === 'image/heif'
        ? URL.createObjectURL(await createAvatarPreview(auth.transport, file, type, controller.signal))
        : URL.createObjectURL(file)
      if (controller.signal.aborted) { URL.revokeObjectURL(next); return }
      setSelectedFile(file)
      setPreviewUrl(next)
      setEditingReplacement(true)
      setEditorImage(next)
    } catch (error) {
      if (controller.signal.aborted) return
      setPreviewError(error instanceof Error ? error.message : 'Не удалось открыть это фото. Выберите другое.')
    } finally { if (previewController.current === controller) { previewController.current = null; setPreviewing(false) } }
  }

  async function confirm(crop: AvatarCrop) {
    if (selectedFile && editingReplacement) {
      await upload.mutateAsync({ file: selectedFile, crop })
    } else if (editTarget) {
      await updateCrop.mutateAsync({ avatarId: editTarget.id, expectedUpdatedAt: editTarget.updatedAt, avatarCrop: crop })
    } else {
      throw new Error('Не удалось загрузить фото профиля. Обновите страницу и попробуйте снова.')
    }
    setEditorImage(null)
    setSelectedFile(null)
    setPreviewUrl(null)
    setEditingReplacement(false)
    setEditTarget(null)
  }

  const hasAvatar = Boolean(avatar)
  const title = compact ? 'Фото профиля' : 'Profile photo'
  return <>
    {editorImage ? <AvatarEditor key={editorImage} busy={busy} image={editorImage} initialCrop={editingReplacement ? fullAvatarCrop : avatar?.avatarCrop ?? fullAvatarCrop}
      onCancel={() => { setEditorImage(null); setSelectedFile(null); setPreviewUrl(null); setEditingReplacement(false); setEditTarget(null) }}
              onChooseAnother={() => fileInput.current?.click()} onConfirm={confirm} /> : null}
    <div aria-label={title} className={compact ? 'grid gap-3' : 'grid gap-5'}>
      <div className="flex flex-wrap items-center gap-5">
        <Avatar className="relative overflow-hidden" data-testid="avatar-preview" size="xl">
          {imageUrl ? <AvatarPhoto alt="" className="absolute inset-0 size-full rounded-full" crop={avatar?.avatarCrop} src={imageUrl} /> : null}
          {!imageUrl ? <AvatarFallback data-testid="avatar-fallback">{initials(displayName, email)}</AvatarFallback> : null}
        </Avatar>
        <div className="grid gap-2">
          <div className="member-account-avatar-actions">
            {hasAvatar ? <>
              <Button disabled={busy || !imageUrl || !avatar?.id || !avatar.updatedAt} onClick={() => { if (imageUrl && avatar?.id && avatar.updatedAt) { setEditTarget({ id: avatar.id, updatedAt: avatar.updatedAt }); setEditorImage(imageUrl) } }} type="button" variant="outline"><Typography variant="memoryButton">Изменить кадрирование</Typography></Button>
              <Button disabled={busy} onClick={() => fileInput.current?.click()} type="button" variant="outline"><Typography variant="memoryButton">Заменить фотографию</Typography></Button>
              <Button disabled={busy} onClick={() => remove.mutate()} type="button" variant="outline"><Typography variant="memoryButton">{remove.isPending ? 'Удаляем…' : 'Удалить фотографию'}</Typography></Button>
            </> : <Button disabled={busy} onClick={() => fileInput.current?.click()} type="button"><Typography variant="memoryButton">Добавить фотографию</Typography></Button>}
          </div>
          <Typography variant="bodySm" tone="muted">{compact ? 'JPEG, PNG, WebP, HEIC или HEIF, до 5 МБ.' : 'Shown next to your name. Only you can see the original file.'}</Typography>
        </div>
        <input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" aria-label="Выбрать фотографию" className="sr-only" data-testid="avatar-file-input" onChange={pick} ref={fileInput} tabIndex={-1} type="file" />
      </div>
      {previewError ? <Typography asChild tone="destructive" variant="bodySm"><p role="alert">{previewError}</p></Typography> : null}
      {upload.isError || updateCrop.isError ? <Typography asChild tone="destructive" variant="bodySm"><p role="alert">Не удалось сохранить фото. Настройки кадрирования сохранены. Нажмите «Повторить» в редакторе.</p></Typography> : null}
      {remove.isError ? <Typography asChild tone="destructive" variant="bodySm"><p role="alert">Не удалось удалить фотографию. Попробуйте снова.</p></Typography> : null}
    </div>
  </>
}

function initials(displayName: string | null, email?: string | null) {
  const source = displayName?.trim() || email || 'Telegram user'
  return source.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}
