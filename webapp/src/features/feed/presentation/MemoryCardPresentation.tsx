import type { ReactNode } from 'react'
import type { MemoryDto } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'

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
        <span aria-hidden="true" className="memoly-author-initials">{authorInitials}</span>
        <div className="memoly-author-copy"><strong>{authorName}</strong><small>{occurredTime}</small></div>
        {actions}
      </div>
      {kind === 'photo' ? <div data-slot="memoly-photo-layout">{media}{captionAndLike}</div> : null}
      {kind === 'video' ? <div className="memoly-video-row" data-slot="memoly-video-layout">{media}{captionAndLike}</div> : null}
      {kind === 'voice' ? <div data-slot="memoly-voice-layout">{media}{captionAndLike}</div> : null}
      {kind === 'note' ? <div data-slot="memoly-note-layout">{body ? <MemoryOpenButton body={body} kind={kind} onOpen={onOpen} /> : null}<LikeButton liked={liked} likeCount={likeCount} onLike={onLike} /></div> : null}
    </article>
  )
}

function MemoryOpenButton({ body, kind, onOpen }: { body: string; kind: MemoryDto['kind']; onOpen: () => void }) {
  return <button aria-label={`Открыть воспоминание ${body || kind}`} className="memoly-memory-open" onClick={onOpen} type="button">{body}</button>
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
      {likeCount > 0 ? <span>{likeCount}</span> : null}
    </button>
  )
}
