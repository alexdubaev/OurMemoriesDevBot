import Cropper from 'react-easy-crop'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import { avatarCropToPercentages, fullAvatarCrop, percentagesToAvatarCrop } from './avatar-crop'
import type { AvatarCrop, CroppedAreaPercentages } from './avatar-crop'
import 'react-easy-crop/react-easy-crop.css'
import './avatar-editor.css'

export function AvatarEditor({ image, initialCrop = fullAvatarCrop, busy = false, canConfirm = true, onCancel, onConfirm, onChooseAnother }: {
  image: string
  initialCrop?: AvatarCrop | null
  busy?: boolean
  canConfirm?: boolean
  onCancel: () => void
  onConfirm: (crop: AvatarCrop) => void | Promise<void>
  onChooseAnother?: () => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<CroppedAreaPercentages | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetVersion, setResetVersion] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [mediaError, setMediaError] = useState(false)
  const confirmingRef = useRef(false)
  const [savedArea] = useState(() => avatarCropToPercentages(initialCrop ?? fullAvatarCrop))
  useEffect(() => {
    if (typeof Image === 'undefined') return
    const probe = new Image()
    probe.onload = () => setMediaError(false)
    probe.onerror = () => { setMediaError(true); setLoaded(false); setArea(null) }
    probe.src = image
    return () => { probe.onload = null; probe.onerror = null }
  }, [image])
  const confirm = async () => {
    if (confirmingRef.current || busy || !canConfirm || !loaded || !area) return
    confirmingRef.current = true
    setConfirming(true)
    setError(null)
    try { await onConfirm(percentagesToAvatarCrop(area)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить фото. Попробуйте ещё раз.') }
    finally { confirmingRef.current = false; setConfirming(false) }
  }
  const locked = busy || confirming
  return <section aria-label="Редактирование фотографии" className="avatar-editor" role="dialog" aria-modal="true">
    <header className="avatar-editor-header">
      <Button disabled={locked} onClick={onCancel} type="button" variant="ghost">Отмена</Button>
      <Typography asChild variant="memoryButton"><strong>Фотография</strong></Typography>
      <Button disabled={locked || !canConfirm || mediaError || !loaded || !area} onClick={() => void confirm()} type="button">{locked ? 'Сохраняем…' : 'Готово'}</Button>
    </header>
    <div className="avatar-editor-surface">
      {!mediaError ? <Cropper disableAutomaticStylesInjection image={image} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
        key={`${image}:${resetVersion}`} initialCroppedAreaPercentages={resetVersion ? undefined : savedArea}
        onMediaLoaded={() => { setLoaded(true); setMediaError(false) }}
        onTouchRequest={() => !busy && !confirming} onWheelRequest={() => !busy && !confirming}
        onCropChange={(value) => { if (!busy && !confirming) setCrop(value) }} onZoomChange={(value) => { if (!busy && !confirming) setZoom(value) }}
        onCropComplete={(percentages) => setArea(percentages)} /> : null}
      {mediaError ? <Typography asChild className="avatar-editor-error" tone="inverse" variant="bodySm"><p role="alert">Не удалось открыть эту фотографию. Выберите другое фото.</p></Typography> : null}
    </div>
    <div className="avatar-editor-controls">
      <Typography asChild variant="label"><label htmlFor="avatar-editor-zoom">Масштаб</label></Typography>
      <input aria-label="Масштаб" disabled={locked} id="avatar-editor-zoom" max="3" min="1" onChange={(e) => setZoom(Number(e.target.value))} step="0.01" type="range" value={zoom} />
      <Button disabled={locked} onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null); setResetVersion((n) => n + 1) }} type="button" variant="outline">Сбросить</Button>
      {onChooseAnother ? <Button disabled={locked} onClick={onChooseAnother} type="button" variant="outline">Выбрать другое</Button> : null}
    </div>
    {error ? <Typography asChild className="avatar-editor-error" tone="inverse" variant="bodySm"><p aria-live="assertive" role="alert"><Typography asChild variant="bodySm"><span>{error}</span></Typography> <Button disabled={locked || !canConfirm || mediaError || !loaded || !area} onClick={() => void confirm()} type="button" variant="ghost">Повторить</Button></p></Typography> : null}
  </section>
}
