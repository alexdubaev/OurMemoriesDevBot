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
  occurredTime,
  onLike,
  onOpen,
}: MemoryCardPresentationProps) {
  const captionAndLike = (
    <div className="memoly-memory-copy">
      {body ? <MemoryOpenButton body={body} kind={kind} onOpen={onOpen} /> : null}
      <LikeButton liked={liked} likeCount={likeCount} onLike={onLike} />
    </div>
  )

  return (
    <article className={`memoly-memory memoly-memory-${kind}`} data-memory-id={memoryId} data-memory-kind={kind}>
      <div className="memoly-author" data-slot="memoly-author-row">
        <Typography as="span" aria-hidden="true" className="memoly-author-initials" variant="memoryMeta">{authorInitials}</Typography>
        <div className="memoly-author-copy"><Typography as="strong" variant="memoryMeta">{authorName}</Typography><Typography as="small" tone="muted" variant="memoryMeta">{occurredTime}</Typography></div>
        <MemoryActions>{actions}</MemoryActions>
      </div>
      {kind === 'photo' ? <MemorySlot slot="memoly-photo-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'video' ? <MemorySlot className="memoly-video-row" slot="memoly-video-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'voice' ? <MemorySlot slot="memoly-voice-layout">{media}{captionAndLike}</MemorySlot> : null}
      {kind === 'note' ? <MemorySlot slot="memoly-note-layout">{body ? <MemoryOpenButton body={body} kind={kind} onOpen={onOpen} /> : null}<LikeButton liked={liked} likeCount={likeCount} onLike={onLike} /></MemorySlot> : null}
    </article>
  )
}

function MemoryActions({ children }: { children: ReactNode }) { return <>{children}</> }

function MemorySlot({ children, className, slot }: { children: ReactNode; className?: string; slot: string }) {
  return <div className={className} data-slot={slot}>{children}</div>
}

function MemoryOpenButton({ body, kind, onOpen }: { body: string; kind: MemoryDto['kind']; onOpen: () => void }) {
  return <Typography asChild variant="memoryCaption"><button aria-label={`Открыть воспоминание ${body || kind}`} className="memoly-memory-open" onClick={onOpen} type="button">{body}</button></Typography>
}

function LikeButton({ liked, likeCount, onLike }: { liked: boolean; likeCount: number; onLike: () => void }) {
  return (
    <button
      aria-label={liked ? 'Убрать сердечко' : 'Поставить сердечко'}
      aria-pressed={liked}
      className={`memoly-like-button${liked ? ' is-liked' : ''}`}
      onClick={onLike}
      type="button"
    >
      <WebpIcon decorative name={liked ? 'heart-filled' : 'heart'} size={20} state={liked ? 'active' : 'default'} />
      {likeCount > 0 ? <Typography as="span" variant="memoryMeta">{likeCount}</Typography> : null}
    </button>
  )
}
