import type { ReactNode } from 'react'

import { BottomNavigation } from '@/components/BottomNavigation'
import { Typography } from '@/components/typography'

export type GiftPagePresentationProps = {
  afterNavigation?: ReactNode
  childName: string
  children: ReactNode
  onAdd: () => void
  onAlbums: () => void
  onCreate: () => void
  onFamily: () => void
  onFeed: () => void
  role: 'full' | 'viewer'
  showAddButton: boolean
}

/** Shared production wishlist shell; its contents and actions are supplied by the caller. */
export function GiftPagePresentation({ afterNavigation, childName, children, onAdd, onAlbums, onCreate, onFamily, onFeed, role, showAddButton }: GiftPagePresentationProps) {
  return <section aria-label="Вишлист" className="gifts-page" data-slot="gifts-page">
    <header className="gifts-header">
      <div>
        <Typography as="h1" className="gifts-title" variant="memoryScreen">Вишлист</Typography>
        <Typography as="p" tone="muted" variant="memoryMeta">{childName}</Typography>
      </div>
      {role === 'full' && showAddButton ? <button className="gift-button gift-button--primary" onClick={onCreate} type="button">
        <Typography as="span" variant="memoryButton">Добавить подарок</Typography>
      </button> : null}
    </header>
    {children}
    <BottomNavigation appearance="memoly" active="gifts" onAdd={onAdd} onAlbums={onAlbums} onFamily={onFamily} onFeed={onFeed} onGifts={() => undefined} role={role} />
    {/* eslint-disable-next-line typographyPolicy/use-typography-component -- ReactNode slot contains existing modal components, never raw text. */}
    {afterNavigation}
  </section>
}
