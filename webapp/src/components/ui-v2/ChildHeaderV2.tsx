import type { CSSProperties } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import type { ChildHeaderProps } from '@/components/ChildHeader'
import { Typography } from '@/components/typography'
import { ChildAvatar } from '@/features/family'
import { getMemolyThemeConfig } from '@/features/theme'

import './ChildHeaderV2.css'

const settingsIcon2x = '/assets/ui-v2/icons/settings-gear@2x.webp'

export function ChildHeaderV2({
  childAvatarCrop = null,
  childAvatarUrl = null,
  childName,
  childSubtitle,
  mode,
  onAllFamilies,
  onOpenChild,
  onOpenSettings,
  theme,
}: ChildHeaderProps) {
  const coverStyle = {
    '--ui-v2-header-cover': `url(${getMemolyThemeConfig(theme).headerArtUrl})`,
  } as CSSProperties

  return (
    <div className={`memoly-child-header-frame ui-v2-child-header-frame${mode === 'family' ? ' ui-v2-child-header-frame-family' : ''}`}>
      {mode === 'family' ? <>
        <div className="ui-v2-family-toolbar">
          {onAllFamilies ? <button aria-label="Сменить семью" className="ui-v2-family-switch" onClick={onAllFamilies} type="button"><WebpIcon decorative name="chevron" size={18} /></button> : <span aria-hidden="true" />}
          <Typography as="h2" className="ui-v2-family-toolbar-title" variant="memoryToolbar">Семья</Typography>
          {onOpenSettings ? <button aria-label="Настройки" className="ui-v2-settings" onClick={onOpenSettings} type="button"><img alt="" height="24" src={settingsIcon2x} srcSet={`${settingsIcon2x} 2x, /assets/ui-v2/icons/settings-gear@3x.webp 3x`} width="24" /></button> : <span aria-hidden="true" />}
        </div>
        <section aria-label="Профиль ребёнка" className="ui-v2-family-child-profile" data-child-header-mode="family" data-ui-version="v2" data-theme={theme} style={coverStyle}>
          {onOpenChild ? <button aria-label={`Редактировать профиль ребёнка: ${childName}`} className="ui-v2-family-child-identity ui-v2-family-child-identity-button" onClick={onOpenChild} type="button">
            <span className="ui-v2-family-child-avatar"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" /></span>
            <span className="ui-v2-family-child-copy"><Typography as="span" className="ui-v2-family-child-name" variant="memoryFamilyName">{childName}</Typography><Typography as="span" className="ui-v2-family-child-subtitle" variant="memoryMeta">{childSubtitle}</Typography></span>
          </button> : <div className="ui-v2-family-child-identity">
            <span className="ui-v2-family-child-avatar"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" /></span>
            <span className="ui-v2-family-child-copy"><Typography as="span" className="ui-v2-family-child-name" variant="memoryFamilyName">{childName}</Typography><Typography as="span" className="ui-v2-family-child-subtitle" variant="memoryMeta">{childSubtitle}</Typography></span>
          </div>}
        </section>
      </> : <section aria-label="Профиль ребёнка" className="ui-v2-child-header" data-child-header-mode="feed" data-ui-version="v2" data-theme={theme} style={coverStyle}>
        <div className="ui-v2-header-actions">
          {onAllFamilies ? <button aria-label="Мои семьи" className="ui-v2-families-action" onClick={onAllFamilies} type="button"><Typography as="span" className="ui-v2-families-label" variant="memoryButton">Мои семьи</Typography><WebpIcon decorative name="chevron" size={16} /></button> : <span aria-hidden="true" />}
          {onOpenSettings ? <button aria-label="Настройки" className="ui-v2-settings" onClick={onOpenSettings} type="button"><img alt="" height="24" src={settingsIcon2x} srcSet={`${settingsIcon2x} 2x, /assets/ui-v2/icons/settings-gear@3x.webp 3x`} width="24" /></button> : <span aria-hidden="true" />}
        </div>
        <div className="ui-v2-child-identity"><span className="ui-v2-child-avatar"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} name={childName} size="feed-header" /></span><Typography as="span" className="ui-v2-child-copy"><Typography as="span" className="ui-v2-child-name" variant="memoryChild">{childName}</Typography><Typography as="span" className="ui-v2-child-subtitle" variant="memoryMeta">{childSubtitle}</Typography></Typography></div>
      </section>}
    </div>
  )
}
