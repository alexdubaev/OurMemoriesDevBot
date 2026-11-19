import type { GiftDto } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import type { AuthenticatedTransport } from '@/platform/api'
import { usePrivateImageResource, type PrivateImageResourceState } from '@/platform/media/use-private-image-url'

import { giftPhotoPath } from './api'
import { boughtSummary, giftActions, reservationStatus, shopName, type GiftViewer } from './model'

export type GiftActionKind = 'reserve' | 'cancel' | 'bought' | 'unbought'

export type GiftCardProps = {
  accountId: string
  familyId: string
  gift: GiftDto
  /** Another action is running, so every button on the page waits. */
  locked: boolean
  onAction: (gift: GiftDto, action: GiftActionKind) => void
  onDelete: (gift: GiftDto) => void
  onEdit: (gift: GiftDto) => void
  onOpenLink: (gift: GiftDto) => void
  pendingAction: GiftActionKind | null
  scopeKey: string
  timeZone?: string
  transport: AuthenticatedTransport
  variant: 'open' | 'bought'
  viewer: GiftViewer
}

export type GiftCardPresentationProps = Pick<GiftCardProps, 'gift' | 'locked' | 'onAction' | 'onDelete' | 'onEdit' | 'onOpenLink' | 'pendingAction' | 'timeZone' | 'variant' | 'viewer'> & {
  photo: PrivateImageResourceState
}

export function GiftCard({
  accountId, familyId, gift, locked, onAction, onDelete, onEdit, onOpenLink, pendingAction, scopeKey, timeZone, transport, variant, viewer,
}: GiftCardProps) {
  const photo = usePrivateImageResource(accountId, giftPhotoPath(familyId, gift.photoMediaId), transport, true, undefined, scopeKey)
  return <GiftCardPresentation gift={gift} locked={locked} onAction={onAction} onDelete={onDelete} onEdit={onEdit} onOpenLink={onOpenLink} pendingAction={pendingAction} photo={photo} timeZone={timeZone} variant={variant} viewer={viewer} />
}

/** Pure card markup shared by the live wishlist and synthetic walkthroughs. */
export function GiftCardPresentation({ gift, locked, onAction, onDelete, onEdit, onOpenLink, pendingAction, photo, timeZone, variant, viewer }: GiftCardPresentationProps) {
  const actions = giftActions(gift, viewer)
  const status = reservationStatus(gift, viewer.currentUserId)
  const shop = shopName(gift.url)
  const meta = [gift.price, shop].filter(Boolean).join(' · ')
  const showStatus = variant === 'open'
  const labels: Record<GiftActionKind, string> = {
    reserve: 'Забронирую', cancel: 'Снять бронь', bought: 'Купил(а)', unbought: 'Отменить отметку',
  }
  const available: GiftActionKind[] = [
    ...(actions.canReserve ? ['reserve' as const] : []),
    ...(actions.canMarkBought ? ['bought' as const] : []),
    ...(actions.canCancelReservation ? ['cancel' as const] : []),
    ...(actions.canUnmarkBought ? ['unbought' as const] : []),
  ]

  return (
    <article className="gift-card" data-gift-id={gift.id} data-gift-variant={variant}>
      <button
        aria-label={`${gift.title}. Открыть в магазине`}
        className="gift-card-link"
        onClick={() => onOpenLink(gift)}
        type="button"
      >
        <span aria-hidden="true" className="gift-card-photo" data-photo-status={photo.status}>
          {photo.url
            ? <img alt="" decoding="async" draggable={false} src={photo.url} />
            : <WebpIcon decorative monochrome name="gift" size={32} />}
        </span>
        <span className="gift-card-body">
          <Typography as="span" className="gift-card-title" variant="memoryBodyMedium">{gift.title}</Typography>
          {meta ? <Typography as="span" className="gift-card-meta" variant="memoryCaption">{meta}</Typography> : null}
          {showStatus
            ? <Typography as="span" className="gift-card-status" data-status={status.kind} variant="memoryCaption">{status.label}</Typography>
            : <Typography as="span" className="gift-card-status" data-status="bought" variant="memoryCaption">{boughtSummary(gift, viewer.currentUserId, timeZone)}</Typography>}
        </span>
      </button>
      {available.length > 0 || actions.canEdit || actions.canDelete ? (
        <div className="gift-card-actions">
          {available.map((action) => (
            <button
              className={`gift-button${action === 'reserve' || action === 'bought' ? ' gift-button--primary' : ''}`}
              disabled={locked}
              key={action}
              onClick={() => onAction(gift, action)}
              type="button"
            >
              <Typography as="span" variant="memoryButton">{pendingAction === action ? 'Сохраняем…' : labels[action]}</Typography>
            </button>
          ))}
          {actions.canEdit ? (
            <button aria-label={`Изменить подарок «${gift.title}»`} className="gift-icon-button" disabled={locked} onClick={() => onEdit(gift)} type="button">
              <WebpIcon decorative monochrome name="edit" size={20} />
            </button>
          ) : null}
          {actions.canDelete ? (
            <button aria-label={`Удалить подарок «${gift.title}»`} className="gift-icon-button" disabled={locked} onClick={() => onDelete(gift)} type="button">
              <WebpIcon decorative monochrome name="trash" size={20} />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
