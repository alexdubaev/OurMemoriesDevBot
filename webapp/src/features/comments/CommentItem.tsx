import type { CommentDto } from '@web-app-demo/contracts'
import { FeedAuthorAvatar } from '@/features/feed/shared-author-avatars'

export function CommentItem({ comment, familyTimezone, onEdit, onDelete }: {
  comment: CommentDto
  familyTimezone: string
  onEdit: (comment: CommentDto) => void
  onDelete: (comment: CommentDto) => void
}) {
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: familyTimezone }).format(new Date(comment.createdAt))
  return <article className="comments-item">
    <FeedAuthorAvatar avatarPath={comment.author.avatarPath} avatarCrop={comment.author.avatarCrop} className="comments-avatar" name={comment.author.name} fallback={<span aria-hidden="true" className="comments-avatar-fallback">{comment.author.name.slice(0, 1).toUpperCase()}</span>} />
    <div className="comments-item-body"><header><strong>{comment.author.name || 'Участник семьи'}</strong><time dateTime={comment.createdAt}>{time}</time>{comment.version > 1 ? <span>изменено</span> : null}</header>
      <p>{comment.body}</p>
      {comment.capabilities.edit || comment.capabilities.delete ? <div className="comments-item-actions">
        {comment.capabilities.edit ? <button onClick={() => onEdit(comment)} type="button">Изменить</button> : null}
        {comment.capabilities.delete ? <button onClick={() => onDelete(comment)} type="button">Удалить</button> : null}
      </div> : null}
    </div>
  </article>
}
