import type { ReactNode, Ref } from 'react'
import type { MemoryDto } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import type { ChildAvatarCrop } from '@/components/ChildHeader'

export type MemoryCardPresentationProps = {
  actions: ReactNode
  authorInitials: string
  authorName: string
  childName?: string
  childAvatarUrl?: string | null
  childAvatarCrop?: ChildAvatarCrop | null
  body: string
  kind: MemoryDto['kind']
  liked: boolean
  likeCount: number
  media: ReactNode
  memoryId: string
  mode?: 'feed' | 'delete-preview'
  isDeleteSource?: boolean
  occurredTime: string
  onLike: () => void
  onOpen: () => void
  seenContentRef?: Ref<HTMLDivElement>
}

export function MemoryCardPresentation({
  actions,
  authorInitials,
  authorName,
  body,
  kind,
  liked,
  likeCount,
  media,
  memoryId,
  mode = 'feed',
  isDeleteSource = false,
  occurredTime,
  onLike,
  onOpen,
  seenContentRef,
}: MemoryCardPresentationProps) {
  const hasCaption = body.trim().length > 0
  const interactive = mode === 'feed'

  return (
    <article aria-hidden={mode === 'delete-preview' || isDeleteSource || undefined} className={`memory-card surface-raised${mode === 'delete-preview' ? ' memoly-memory-delete-preview' : ''}${isDeleteSource ? ' memoly-memory-delete-source' : ''}`} data-memory-id={memoryId} data-memory-kind={kind}>
      <header className="memory-header" data-slot="memoly-author-row">
        <span aria-hidden="true" className="author-avatar"><Typography as="span" className="author-initials" variant="memoryMeta">{authorInitials}</Typography></span>
        <div className="author-meta"><Typography as="div" className="author-name" variant="memoryMeta">{authorName}</Typography><Typography as="div" className="author-time" tone="muted" variant="memoryMeta">{occurredTime}</Typography></div>
        <MemoryActions>{mode === 'delete-preview' ? null : actions}</MemoryActions>
      </header>
      {kind !== 'note' ? <MemorySlot className={kind === 'video' ? 'media-well surface-inset video-wrap' : 'media-well surface-inset'} contentRef={seenContentRef} slot={`memoly-${kind}-layout`}>{media}</MemorySlot> : null}
      <div className="actions">
        <LikeButton interactive={interactive} liked={liked} likeCount={likeCount} onLike={onLike} />
      </div>
      {kind === 'video'
        ? hasCaption ? <Typography className="caption" variant="memoryCaption">{body}</Typography> : null
        : kind === 'note'
          ? <MemorySlot className="caption" contentRef={seenContentRef} ready={hasCaption} slot="memoly-note-layout">{body ? <MemoryOpenButton body={body} className="note-body" interactive={interactive} kind={kind} onOpen={onOpen} /> : null}</MemorySlot>
          : <div className="caption"><MemoryOpenButton body={body} className={body ? undefined : 'caption-open-empty'} interactive={interactive} kind={kind} onOpen={onOpen} /></div>}
    </article>
  )
}

function MemoryActions({ children }: { children: ReactNode }) { return <>{children}</> }

function MemorySlot({ children, className, contentRef, ready, slot }: { children: ReactNode; className?: string; contentRef?: Ref<HTMLDivElement>; ready?: boolean; slot: string }) {
  return <div className={className} data-seen-main="" data-seen-ready={ready === undefined ? undefined : String(ready)} data-slot={slot} ref={contentRef}>{children}</div>
}

function MemoryOpenButton({ body, className, interactive, kind, onOpen }: { body: string; className?: string; interactive: boolean; kind: MemoryDto['kind']; onOpen: () => void }) {
  const content = className === 'note-body' ? <><WebpIcon decorative name="note" size={27} /><Typography as="span" variant="memoryCaption">{body}</Typography></> : body || <Typography as="span" variant="memoryCaption">Открыть</Typography>
  if (!interactive) return <Typography as="div" className={`caption-open${className ? ` ${className}` : ''}`} variant="memoryCaption">{content}</Typography>
  return <Typography asChild variant="memoryCaption"><button aria-label={`Открыть воспоминание ${body || kind}`} className={`caption-open${className ? ` ${className}` : ''}`} onClick={onOpen} type="button">{content}</button></Typography>
}

function LikeButton({ interactive, liked, likeCount, onLike }: { interactive: boolean; liked: boolean; likeCount: number; onLike: () => void }) {
  return (
    <button
      aria-label={liked ? 'Убрать сердечко' : 'Поставить сердечко'}
      aria-pressed={liked}
      className={`action like${liked ? ' is-liked on' : ''}`}
      disabled={!interactive}
      onClick={onLike}
      type="button"
    >
      <WebpIcon decorative name={liked ? 'heart-filled' : 'heart'} size={20} state={liked ? 'active' : 'default'} />
      {likeCount > 0 ? <Typography as="span" variant="memoryMeta">{likeCount}</Typography> : null}
    </button>
  )
}
