import type { ReactNode } from 'react'
import type { MemoryDto } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'

export type MemoryCardPresentationProps = {
  actions: ReactNode
  authorInitials: string
  authorName: string
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
}: MemoryCardPresentationProps) {
  const hasCaption = body.trim().length > 0
  const interactive = mode === 'feed'
  const captionAndLike = (
    <div className="memoly-memory-copy">
      {kind === 'video'
        ? hasCaption ? <Typography className="memoly-video-caption" variant="memoryCaption">{body}</Typography> : null
        : <MemoryOpenButton body={body} className={body ? undefined : 'memoly-memory-open-empty'} interactive={interactive} kind={kind} onOpen={onOpen} />}
      <LikeButton interactive={interactive} liked={liked} likeCount={likeCount} onLike={onLike} />
    </div>
  )

  return (
    <article aria-hidden={mode === 'delete-preview' || isDeleteSource || undefined} className={`memoly-memory memoly-memory-${kind}${mode === 'delete-preview' ? ' memoly-memory-delete-preview' : ''}${isDeleteSource ? ' memoly-memory-delete-source' : ''}`} data-memory-id={memoryId} data-memory-kind={kind}>
      <div className="memoly-author" data-slot="memoly-author-row">
        <Typography as="span" aria-hidden="true" className="memoly-author-initials" variant="memoryMeta">{authorInitials}</Typography>
        <div className="memoly-author-copy"><Typography as="strong" variant="memoryMeta">{authorName}</Typography><Typography as="small" tone="muted" variant="memoryMeta">{occurredTime}</Typography></div>
        <MemoryActions>{mode === 'delete-preview' ? null : actions}</MemoryActions>
      </div>
      {kind === 'photo' ? <MemorySlot slot="memoly-photo-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'video' ? <MemorySlot className={`memoly-video-row${hasCaption ? ' has-caption' : ''}`} slot="memoly-video-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'voice' ? <MemorySlot slot="memoly-voice-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'note' ? <MemorySlot slot="memoly-note-layout">{body ? <MemoryOpenButton body={body} className="memoly-note-body" interactive={interactive} kind={kind} onOpen={onOpen} /> : null}<LikeButton interactive={interactive} liked={liked} likeCount={likeCount} onLike={onLike} /></MemorySlot> : null}
    </article>
  )
}

function MemoryActions({ children }: { children: ReactNode }) { return <>{children}</> }

function MemorySlot({ children, className, slot }: { children: ReactNode; className?: string; slot: string }) {
  return <div className={className} data-slot={slot}>{children}</div>
}

function MemoryOpenButton({ body, className, interactive, kind, onOpen }: { body: string; className?: string; interactive: boolean; kind: MemoryDto['kind']; onOpen: () => void }) {
  const content = className === 'memoly-note-body' ? <><WebpIcon decorative name="note" size={27} /><Typography as="span" variant="memoryCaption">{body}</Typography></> : body || <Typography as="span" variant="memoryCaption">Открыть</Typography>
  if (!interactive) return <Typography as="div" className={`memoly-memory-open${className ? ` ${className}` : ''}`} variant="memoryCaption">{content}</Typography>
  return <Typography asChild variant="memoryCaption"><button aria-label={`Открыть воспоминание ${body || kind}`} className={`memoly-memory-open${className ? ` ${className}` : ''}`} onClick={onOpen} type="button">{content}</button></Typography>
}

function LikeButton({ interactive, liked, likeCount, onLike }: { interactive: boolean; liked: boolean; likeCount: number; onLike: () => void }) {
  return (
    <button
      aria-label={liked ? 'Убрать сердечко' : 'Поставить сердечко'}
      aria-pressed={liked}
      className={`memoly-like-button${liked ? ' is-liked' : ''}`}
      disabled={!interactive}
      onClick={onLike}
      type="button"
    >
      <WebpIcon decorative name={liked ? 'heart-filled' : 'heart'} size={20} state={liked ? 'active' : 'default'} />
      {likeCount > 0 ? <Typography as="span" variant="memoryMeta">{likeCount}</Typography> : null}
    </button>
  )
}
