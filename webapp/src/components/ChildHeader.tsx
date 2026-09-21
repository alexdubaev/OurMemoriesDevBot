import type { CSSProperties } from 'react'

import { BrandLogo } from '@/components/BrandLogo'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { ChildAvatar } from '@/features/family'
import { getMemolyThemeConfig, type MemolyTheme } from '@/features/theme'

import './ChildHeader.css'

export type ChildAvatarCrop = { x: number; y: number; width: number; height: number }

export type ChildHeaderProps = {
  childName: string
  childSubtitle: string
  childAvatarUrl?: string | null
  childAvatarCrop?: ChildAvatarCrop | null
  theme: MemolyTheme
  mode: 'feed' | 'family'
  onOpenChild?: () => void
  onOpenSettings?: () => void
}

/** Shared Feed/Family identity header. Family controls are overlays only. */
export function ChildHeader({
  childAvatarCrop = null,
  childAvatarUrl = null,
  childName,
  childSubtitle,
  mode,
  onOpenChild,
  onOpenSettings,
  theme,
}: ChildHeaderProps) {
  const artStyle = { '--memoly-header-art': `url(${getMemolyThemeConfig(theme).headerArtUrl})` } as CSSProperties

  return (
    <section className="memoly-child-header" data-child-header-mode={mode} data-slot="memoly-child-hero" style={artStyle}>
      <img aria-hidden className="memoly-child-header-art" src={getMemolyThemeConfig(theme).headerArtUrl} alt="" />
      <div className="memoly-child-header-content">
        <div className="memoly-child-header-brand">
          <BrandLogo className="memoly-child-header-logo" />
        </div>
        <button
          aria-label={`Открыть профиль ребёнка: ${childName}`}
          className="memoly-child-header-identity"
          disabled={!onOpenChild}
          onClick={onOpenChild}
          type="button"
        >
          <ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" />
          <span className="memoly-child-header-copy">
            <Typography as="strong" variant="memoryChild">{childName}</Typography>
            <Typography as="small" tone="muted" variant="memoryMeta">{childSubtitle}</Typography>
          </span>
          {mode === 'family' && onOpenChild ? <WebpIcon decorative className="memoly-child-header-chevron" name="chevron" size={24} /> : null}
        </button>
        {mode === 'family' && onOpenSettings ? (
          <button aria-label="Настройки" className="memoly-child-header-settings" onClick={onOpenSettings} type="button">
            <WebpIcon decorative name="gear" size={22} />
          </button>
        ) : null}
      </div>
    </section>
  )
}
