import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ChildDto, MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { ChildTagPicker } from '@/components/ui-v2/ChildTagPicker'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import { loadMemory, replaceMemoryChildTags } from './api'
import { initialTagSelection, sameTagSelection, tagsFromSelection, taggableAttachments, WHOLE_PUBLICATION_SLOT, type TagSelection } from './child-tag-editor'
import { applyChildTagsToCachedFeeds, isFeedListKey } from './queries'
import './child-tag-editor.css'

const CONFLICT_TEXT = 'Отметки уже изменили, обновите'

type Status = 'idle' | 'saving' | 'conflict' | 'stale' | 'error'

function previewPath(attachment: MemoryAttachment) {
  if (attachment.source === 'private_storage') return attachment.previewPath ?? attachment.displayPath
  if (attachment.source === 'telegram') return attachment.thumbnailPath
  return attachment.posterState === 'ready' ? attachment.posterPath ?? null : null
}

function SlotThumbnail({ accountId, attachment, transport }: { accountId: string; attachment: MemoryAttachment; transport: AuthenticatedTransport }) {
  const url = usePrivateImageUrl(accountId, previewPath(attachment) ?? null, transport)
  return <span aria-hidden="true" className="memoly-tag-editor-thumb">{url ? <img alt="" src={url} /> : attachment.kind === 'video' ? <WebpIcon decorative monochrome name="video" size={20} /> : <Typography as="span" variant="memoryMeta">Фото</Typography>}</span>
}

/**
 * «Отметить детей»: a choice of children for every photo and video of a publication, or one shared
 * choice when it has none. The choice is kept when saving fails, and a version conflict reloads the
 * current tags instead of overwriting them.
 */
export function MemoryChildTagsEditor({ accountId, childOptions, memory, onClose, returnFocusRef, transport }: { accountId: string; childOptions: readonly ChildDto[]; memory: MemoryDto; onClose: () => void; returnFocusRef: RefObject<HTMLElement | null>; transport: AuthenticatedTransport }) {
  const queryClient = useQueryClient()
  const [version, setVersion] = useState(memory.childTagsVersion ?? 1)
  const [baseline, setBaseline] = useState<TagSelection>(() => initialTagSelection(memory, childOptions))
  const [selection, setSelection] = useState<TagSelection>(baseline)
  const [status, setStatus] = useState<Status>('idle')
  const busy = useRef(false)
  const slots = taggableAttachments(memory)
  const dirty = !sameTagSelection(selection, baseline)
  const locked = status === 'saving'

  const finish = (saved: { childTags: NonNullable<MemoryDto['childTags']>; childTagsVersion: number }) => {
    applyChildTagsToCachedFeeds(queryClient, memory.familyId, memory.id, saved)
    // The memory may enter or leave any child's list and «Без отметки».
    void queryClient.invalidateQueries({ predicate: (query) => isFeedListKey(query.queryKey, memory.familyId) })
    onClose()
  }
  const choose = (slot: string, next: string[]) => { setSelection((current) => ({ ...current, [slot]: next })); if (status === 'error') setStatus('idle') }
  const requestClose = () => {
    if (locked) return
    if (dirty && !window.confirm('Закрыть без сохранения? Выбор детей будет потерян.')) return
    onClose()
  }

  async function loadCurrent() {
    if (busy.current) return
    busy.current = true
    try {
      const fresh = await loadMemory(transport, memory.familyId, memory.id)
      const current = initialTagSelection(fresh, childOptions)
      if (fresh.childTags && fresh.childTagsVersion !== undefined && sameTagSelection(current, selection)) {
        // Someone (or this very request, whose answer got lost) already saved exactly this choice.
        finish({ childTags: fresh.childTags, childTagsVersion: fresh.childTagsVersion })
        return
      }
      if (fresh.childTags && fresh.childTagsVersion !== undefined) applyChildTagsToCachedFeeds(queryClient, memory.familyId, memory.id, { childTags: fresh.childTags, childTagsVersion: fresh.childTagsVersion })
      setVersion(fresh.childTagsVersion ?? version)
      setBaseline(current)
      setSelection(current)
      setStatus('conflict')
    } catch { setStatus('stale') } finally { busy.current = false }
  }

  async function save() {
    if (busy.current || locked || (!dirty && status !== 'error')) return
    busy.current = true
    setStatus('saving')
    try {
      const saved = await replaceMemoryChildTags(transport, memory.familyId, memory.id, tagsFromSelection(memory, selection, childOptions), version)
      busy.current = false
      finish(saved)
    } catch (reason) {
      busy.current = false
      if (reason instanceof ApiRequestError && reason.status === 409) { setStatus('stale'); await loadCurrent(); return }
      setStatus('error')
    }
  }

  const message = status === 'conflict' ? `${CONFLICT_TEXT}. Показаны свежие отметки: проверьте выбор и сохраните снова.`
    : status === 'stale' ? `${CONFLICT_TEXT}. Не удалось загрузить свежие отметки, проверьте соединение.`
      : status === 'error' ? 'Не удалось сохранить отметки. Ваш выбор не потерян, повторите.' : null
  const primaryLabel = status === 'saving' ? 'Сохраняем…' : status === 'stale' ? 'Обновить' : status === 'error' ? 'Повторить' : 'Сохранить'

  return <DialogPrimitive.Root onOpenChange={(open) => { if (!open) requestClose() }} open>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        className="fixed inset-0 z-50 flex items-end p-3 outline-none"
        onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }}
      >
        <section className="memoly-detail-surface memoly-tag-editor max-h-[90dvh] w-full overflow-y-auto rounded-[var(--radius-card)] bg-card p-5" data-memoly-feed data-tag-editor>
          <DialogPrimitive.Title asChild><Typography as="h2" variant="memoryHero">Отметить детей</Typography></DialogPrimitive.Title>
          <DialogPrimitive.Description asChild><Typography className="mt-2" tone="muted" variant="memoryMeta">{slots.length > 0 ? 'Отметьте, кто на каждой фотографии и видео. Воспоминание появится на страницах отмеченных детей.' : 'В этом воспоминании нет фото и видео, поэтому дети отмечаются на всём воспоминании.'}</Typography></DialogPrimitive.Description>
          {slots.length > 0
            ? <ol className="memoly-tag-editor-slots">{slots.map((attachment, index) => {
              const noun = attachment.kind === 'video' ? 'видео' : 'фото'
              return <li className="memoly-tag-editor-slot" data-tag-slot={attachment.id} key={attachment.id}>
                <div className="memoly-tag-editor-slot-head"><SlotThumbnail accountId={accountId} attachment={attachment} transport={transport} /><Typography as="span" variant="memoryBodyMedium">{attachment.kind === 'video' ? 'Видео' : 'Фото'} {index + 1} из {slots.length}</Typography></div>
                <ChildTagPicker childOptions={childOptions} disabled={locked} hint={null} legend={`Кто на этом ${noun}`} onChange={(next) => choose(attachment.id, next)} selected={selection[attachment.id] ?? []} />
              </li>
            })}</ol>
            : <div className="memoly-tag-editor-slots" data-tag-slot={WHOLE_PUBLICATION_SLOT}><ChildTagPicker childOptions={childOptions} disabled={locked} onChange={(next) => choose(WHOLE_PUBLICATION_SLOT, next)} selected={selection[WHOLE_PUBLICATION_SLOT] ?? []} /></div>}
          {message ? <Typography as="p" className="memoly-tag-editor-message" role="alert" variant="memoryMeta">{message}</Typography> : null}
          <div className="memoly-tag-editor-actions">
            <button className="memoly-tag-editor-button is-primary" disabled={locked || (status === 'idle' && !dirty)} onClick={() => { if (status === 'stale') void loadCurrent(); else void save() }} type="button"><Typography as="span" variant="memoryButton">{primaryLabel}</Typography></button>
            <button className="memoly-tag-editor-button" disabled={locked} onClick={requestClose} type="button"><Typography as="span" variant="memoryButton">Отмена</Typography></button>
          </div>
        </section>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}
