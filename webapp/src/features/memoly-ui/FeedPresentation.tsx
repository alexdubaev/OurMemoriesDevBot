import type { MemoryAttachment, MemoryDto } from '@web-app-demo/contracts'
import type { ReactNode } from 'react'

import { Typography } from '@/components/typography'
import { toMemoryPresentation } from './adapters'

type PrivatePhoto = Extract<MemoryAttachment, { source: 'private_storage' }>

export type FeedAttachmentRenderer = (
  attachment: MemoryAttachment,
  memory: MemoryDto,
  photoAlbum: PrivatePhoto[],
  photoIndex: number,
) => ReactNode

export type FeedMemoryListProps = {
  familyTimezone: string
  items: MemoryDto[]
  onDelete: (memory: MemoryDto) => Promise<unknown>
  onLike: (memory: MemoryDto) => void
  onOpen: (memory: MemoryDto) => void
  renderAttachment: FeedAttachmentRenderer
  renderDeleteAction?: (memory: MemoryDto, onDelete: (memory: MemoryDto) => Promise<unknown>) => ReactNode
}

export function FeedMemoryList({
  familyTimezone,
  items,
  onDelete,
  onLike,
  onOpen,
  renderAttachment,
  renderDeleteAction,
}: FeedMemoryListProps) {
  return (
    <div className="ml-content" data-slot="feed-memory-list">
      {items.map((memory, index) => {
        const presentation = toMemoryPresentation(memory, familyTimezone)
        const previousDateKey = index > 0 ? toMemoryPresentation(items[index - 1]!, familyTimezone).dateKey : null
        const showDate = presentation.dateKey !== previousDateKey
        return (
          <div className="flex flex-col gap-3" key={memory.id}>
            {showDate ? <Typography className="ml-date" data-slot="date-heading" variant="memoryDate">{presentation.dateLabel}</Typography> : null}
            <FeedMemoryCard
              familyTimezone={familyTimezone}
              memory={memory}
              onDelete={onDelete}
              onLike={onLike}
              onOpen={onOpen}
              renderAttachment={renderAttachment}
              renderDeleteAction={renderDeleteAction}
            />
          </div>
        )
      })}
    </div>
  )
}

export type FeedMemoryCardProps = {
  familyTimezone: string
  memory: MemoryDto
  media?: ReactNode
  onDelete: (memory: MemoryDto) => Promise<unknown>
  onLike: (memory: MemoryDto) => void
  onOpen: (memory: MemoryDto) => void
  renderAttachment?: FeedAttachmentRenderer
  renderDeleteAction?: (memory: MemoryDto, onDelete: (memory: MemoryDto) => Promise<unknown>) => ReactNode
}

export function FeedMemoryCard({
  familyTimezone,
  memory,
  media,
  onDelete,
  onLike,
  onOpen,
  renderAttachment,
  renderDeleteAction,
}: FeedMemoryCardProps) {
  const presentation = toMemoryPresentation(memory, familyTimezone)
  const primary = memory.attachments[0]
  const photoAlbum = memory.attachments.filter((attachment): attachment is PrivatePhoto =>
    attachment.source === 'private_storage' && attachment.kind === 'photo',
  )
  const renderedMedia = media ?? (primary && renderAttachment
    ? renderAttachment(primary, memory, photoAlbum, 0)
    : null)

  return (
    <article className="ml-memory overflow-hidden rounded-[var(--radius-card)] bg-card text-card-foreground shadow-[var(--shadow-card)]" data-memory-id={memory.id} data-slot="memory-card-frame">
      {/* Presentation slot intentionally accepts native media/controller elements. */}
      {renderedMedia ? <div className="ml-media-slot" data-slot="memory-media">{renderedMedia}</div> : null} {/* eslint-disable-line typographyPolicy/use-typography-component */}
      <div className="ml-author flex items-center justify-between gap-3">
        <div>
          <Typography variant="memoryMeta">{presentation.author.displayName}</Typography>
          <Typography tone="muted" variant="memoryMeta">{presentation.timeLabel}</Typography>
        </div>
        {presentation.capabilities.delete && renderDeleteAction ? renderDeleteAction(memory, onDelete) : null}
      </div>
      <button
        aria-label={`Открыть воспоминание ${presentation.body || presentation.type}`}
        className="ml-caption block w-full text-left"
        onClick={() => onOpen(memory)}
        type="button"
      >
        {presentation.body ? <Typography as="span" className="ml-caption-text whitespace-pre-wrap" variant="memoryCaption">{presentation.body}</Typography> : null}
      </button>
      <div className="ml-note-like border-t border-border">
        <Typography asChild variant="memoryMeta"><button aria-pressed={presentation.liked} className={`ml-like${presentation.liked ? ' liked' : ''}`} onClick={() => onLike(memory)} type="button">
          {presentation.liked ? 'С сердечком' : 'Сердечко'} · {presentation.likeCount}
        </button></Typography>
        <Typography tone="muted" variant="memoryMeta">{kindLabel(presentation.type)}</Typography>
      </div>
    </article>
  )
}

function kindLabel(kind: MemoryDto['kind']) {
  return ({ note: 'Заметка', photo: 'Фото', video: 'Видео', voice: 'Голос' })[kind]
}
