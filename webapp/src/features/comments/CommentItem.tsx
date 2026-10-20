import type { CommentDto } from '@web-app-demo/contracts'
import { FeedAuthorAvatar } from '@/features/feed'
import { Typography } from '@/components/typography'

export function CommentItem({ comment, familyTimezone, onEdit, onDelete }: {
  comment: CommentDto
  familyTimezone: string
  onEdit: (comment: CommentDto) => void
  onDelete: (comment: CommentDto) => void
}) {
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: familyTimezone }).format(new Date(comment.createdAt))
  return <article className="comments-item">
    <FeedAuthorAvatar avatarPath={comment.author.avatarPath} avatarCrop={comment.author.avatarCrop} className="comments-avatar" name={comment.author.name} fallback={<span aria-hidden="true" className="comments-avatar-fallback"><Typography as="span" variant="memoryMeta">{comment.author.name.slice(0, 1).toUpperCase()}</Typography></span>} />
    <div className="comments-item-body"><header><Typography as="strong" variant="memoryMeta">{comment.author.name || 'Участник семьи'}</Typography><Typography as="time" dateTime={comment.createdAt} variant="memoryMeta">{time}</Typography>{comment.version > 1 ? <Typography as="span" variant="memoryMeta">изменено</Typography> : null}</header>
      <Typography as="p" variant="bodySm">{comment.body}</Typography>
      {comment.capabilities.edit || comment.capabilities.delete ? <div className="comments-item-actions">
        {comment.capabilities.edit ? <button onClick={() => onEdit(comment)} type="button"><Typography as="span" variant="memoryButton">Изменить</Typography></button> : null}
        {comment.capabilities.delete ? <button onClick={() => onDelete(comment)} type="button"><Typography as="span" variant="memoryButton">Удалить</Typography></button> : null}
      </div> : null}
    </div>
  </article>
}
