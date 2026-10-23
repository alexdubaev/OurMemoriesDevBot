/* eslint-disable typographyPolicy/use-typography-component -- the commit receipt is a semantic status panel. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChildDto, MemoryDto } from '@web-app-demo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { NoteComposer, PhotoComposer } from '@/features/composer'
import { VideoComposer } from '@/features/max-video-upload'
import { AddSheetPresentation } from '@/features/memoly-ui'
import { loadMemory, feedQueryKeys } from '@/features/feed'
import type { AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'

export function ComposerHost({ active = true, childId, childOptions, initialChildIds, familyId, familyTimezone, hostBridge, transport, onClose, attach }: { active?: boolean; childId: string; /** Two or more children switch on the «who is in it» choice in every form. */ childOptions?: ChildDto[]; initialChildIds?: string[]; familyId: string; familyTimezone: string; hostBridge: HostBridge; transport: AuthenticatedTransport; onClose: () => void; attach?: (memory: MemoryDto) => Promise<void> }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'photo' | 'note' | 'video' | null>(null)
  const modeRef = useRef(mode)
  const [sheet, setSheet] = useState(true)
  const [published, setPublished] = useState<MemoryDto | { id: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attached, setAttached] = useState(false)
  const request = useRef(new AbortController())
  const attaching = useRef(false)
  const cancellationBlocked = useRef(false)
  const busyRef = useRef(busy)
  const closeRef = useRef(onClose)
  const cancelRequest = useRef(onClose)
  useLayoutEffect(() => { busyRef.current = busy; closeRef.current = onClose }, [busy, onClose])
  useEffect(() => {
    // StrictMode effect replay aborts the first controller before the live
    // composer can publish. Give the replayed mount a fresh request scope.
    if (request.current.signal.aborted) request.current = new AbortController()
    return () => request.current.abort()
  }, [])
  useEffect(() => { if (!active) { request.current.abort(); onClose() } }, [active, onClose])
  useEffect(() => {
    if (!active) return
    return hostBridge.onBack(() => {
      if (cancellationBlocked.current || busyRef.current || attaching.current) return
      cancelRequest.current()
    })
  }, [active, hostBridge])
  const onPublished = (memory: MemoryDto | { id: string }) => {
    if (request.current.signal.aborted) return
    cancellationBlocked.current = false
    cancelRequest.current = closeRef.current
    setPublished(memory)
    void queryClient.invalidateQueries({ queryKey: feedQueryKeys.all })
  }
  async function attachOnly() {
    if (!published || !attach || attaching.current || attached) return
    attaching.current = true; setBusy(true); setError(null)
    try {
      const memory = 'attachments' in published ? published : await loadMemory(transport, familyId, published.id, request.current.signal)
      if (request.current.signal.aborted) return
      await attach(memory)
      if (!request.current.signal.aborted) setAttached(true)
    } catch { if (!request.current.signal.aborted) setError('Воспоминание сохранено в ленте, но связь с альбомом не подтверждена. Повторим только прикрепление, без повторной публикации.') }
    finally { attaching.current = false; if (!request.current.signal.aborted) setBusy(false) }
  }
  const pick = (next: NonNullable<typeof mode>) => { modeRef.current = next; setMode(next); setSheet(false) }
  return <div aria-label="Добавление воспоминания" className="albums-composer-host">
    {attach ? <p className="albums-upload-notice">Будет сохранено в семейную ленту и этот альбом</p> : null}
    {published ? <section aria-live="polite" className="albums-commit-receipt" role="status"><h1>Сохранено в семейную ленту</h1>{attach && !attached ? <><p>Оригинал уже опубликован. Осталось прикрепить его к альбому.</p>{error ? <p className="albums-error" role="alert">{error}</p> : null}<button className="albums-primary" disabled={busy} onClick={() => void attachOnly()} type="button">{busy ? 'Прикрепляем…' : error ? 'Повторить только прикрепление' : 'Прикрепить к альбому'}</button></> : <p>{attached ? 'Готово, материал в альбоме.' : 'Можно вернуться к прежнему разделу.'}</p>}<button className="albums-secondary" disabled={busy} onClick={onClose} type="button">{attached || !attach ? 'Вернуться' : 'Вернуться без прикрепления'}</button></section> : mode === 'photo' ? <PhotoComposer childId={childId} childOptions={childOptions} initialChildIds={initialChildIds} familyId={familyId} familyTimezone={familyTimezone} onCancel={onClose} onPublished={onPublished} onSuccess={onClose} onCancellationBlockedChange={(blocked) => { cancellationBlocked.current = blocked }} onCancelRequestChange={(cancel) => { cancelRequest.current = cancel }} transport={transport} /> : mode === 'note' ? <NoteComposer childId={childId} childOptions={childOptions} initialChildIds={initialChildIds} familyId={familyId} familyTimezone={familyTimezone} onCancel={onClose} onPublished={onPublished} onSuccess={onClose} onCancellationBlockedChange={(blocked) => { cancellationBlocked.current = blocked }} onCancelRequestChange={(cancel) => { cancelRequest.current = cancel }} transport={transport} /> : mode === 'video' ? <VideoComposer childId={childId} childOptions={childOptions} initialChildIds={initialChildIds} familyId={familyId} familyTimezone={familyTimezone} onCancel={onClose} onPublished={onPublished} onSuccess={onClose} onCancellationBlockedChange={(blocked) => { cancellationBlocked.current = blocked }} onCancelRequestChange={(cancel) => { cancelRequest.current = cancel }} transport={transport} /> : <section className="albums-commit-receipt"><h1>Добавить воспоминание</h1><button onClick={onClose} type="button">Отмена</button></section>}
    <AddSheetPresentation hostBridge={hostBridge} onNote={() => pick('note')} onOpenChange={(open) => { setSheet(open); if (!open) setTimeout(() => { if (!modeRef.current && !request.current.signal.aborted) onClose() }, 0) }} onPhoto={() => pick('photo')} onVideo={() => pick('video')} open={active && sheet} role="full" />
  </div>
}
