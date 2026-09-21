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

/** Shared Feed/Family identity header. Keep this composition identical on both routes. */
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
  const artStyle = {
    '--theme-header-art': `url(${getMemolyThemeConfig(theme).headerArtUrl})`,
  } as CSSProperties

  return (
    <section aria-label="Профиль ребёнка" className="top-card surface-raised memoly-child-header" data-child-header-mode={mode} data-slot="memoly-child-hero" data-theme={theme} style={artStyle}>
      <div className="brand-block">
        <BrandLogo className="brand" />
        <Typography as="div" className="tagline" variant="memoryMeta">Маленькие моменты<br />большое счастье</Typography>
      </div>
      {onOpenChild ? (
        <button aria-label={`Открыть профиль ребёнка: ${childName}`} className="profile-row profile-row-button" onClick={onOpenChild} type="button">
          <span className="child-avatar-wrap"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" /></span>
          <span className="child-copy"><Typography as="span" className="child-name" variant="memoryChild">{childName}</Typography><Typography as="span" className="child-age" tone="muted" variant="memoryMeta">{childSubtitle}</Typography></span>
          {mode === 'family' ? <WebpIcon decorative className="family-profile-chevron" name="chevron" size={24} /> : null}
        </button>
      ) : (
        <div className="profile-row">
          <span className="child-avatar-wrap"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" /></span>
          <span className="child-copy"><Typography as="span" className="child-name" variant="memoryChild">{childName}</Typography><Typography as="span" className="child-age" tone="muted" variant="memoryMeta">{childSubtitle}</Typography></span>
        </div>
      )}
      <div aria-hidden="true" className="header-art"><span className="sun-shape" /><span className="cloud" /><span className="leaf" /></div>
      {mode === 'family' && onOpenSettings ? <button aria-label="Настройки" className="settings family-only-settings" onClick={onOpenSettings} type="button"><WebpIcon decorative name="gear" size={22} /></button> : null}
    </section>
  )
}
