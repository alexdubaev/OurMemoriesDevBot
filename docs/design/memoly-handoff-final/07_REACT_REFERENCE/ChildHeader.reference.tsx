import type { ReactNode } from 'react'

export type ChildHeaderProps = {
  avatar: ReactNode
  childName: string
  childSubtitle: string
  mode: 'feed' | 'family'
  onOpenChild?: () => void
  onOpenSettings?: () => void
  themeArtSrc: string
}

/**
 * One base geometry for Feed and Family.
 * Family adds controls without moving identity content.
 */
export function ChildHeader({
  avatar,
  childName,
  childSubtitle,
  mode,
  onOpenChild,
  onOpenSettings,
  themeArtSrc,
}: ChildHeaderProps) {
  return (
    <section className="memoly-child-header">
      <img aria-hidden className="memoly-child-header-art" src={themeArtSrc} alt="" />

      <div className="memoly-child-header-brand">{/* BrandLogo */}</div>

      <button
        className="memoly-child-header-identity"
        disabled={!onOpenChild}
        onClick={onOpenChild}
        type="button"
      >
        {avatar}
        <span>
          <strong>{childName}</strong>
          <small>{childSubtitle}</small>
        </span>
      </button>

      {mode === 'family' && onOpenSettings ? (
        <button
          aria-label="Настройки"
          className="memoly-child-header-settings"
          onClick={onOpenSettings}
          type="button"
        >
          {/* existing WebpIcon */}
        </button>
      ) : null}
    </section>
  )
}
