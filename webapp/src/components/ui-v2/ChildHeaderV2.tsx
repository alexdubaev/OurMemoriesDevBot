import type { ChildHeaderProps } from '@/components/ChildHeader'
import { Typography } from '@/components/typography'
import { ChildAvatar } from '@/features/family'

import './ChildHeaderV2.css'

export function ChildHeaderV2({ childAvatarCrop = null, childAvatarStatus, childAvatarUrl = null, childName, childSubtitle, mode, onAllFamilies, onOpenChild, onOpenSettings, theme }: ChildHeaderProps) {
  return (
    <div className="memoly-child-header-frame ui-v2-child-header-frame">
      <section aria-label="Профиль ребёнка" className="ui-v2-child-header" data-child-header-mode={mode} data-ui-version="v2" data-theme={theme}>
        <div className="ui-v2-header-actions">
          <Typography as="span" className="astryx-header-brand" variant="memoryScreen">memoLy</Typography>
          {onAllFamilies ? <button aria-label="Мои семьи" className="ui-v2-families-action" onClick={onAllFamilies} type="button"><Typography as="span" className="ui-v2-families-label" variant="memoryButton">Мои семьи</Typography></button> : <span aria-hidden="true" />}
          {onOpenSettings ? <button aria-label="Настройки" className="ui-v2-settings" onClick={() => onOpenSettings()} type="button"><Typography as="span" variant="memoryButton">Настройки</Typography></button> : <span aria-hidden="true" />}
        </div>
        {mode === 'family' && onOpenChild ? <button aria-label={`Редактировать профиль ребёнка: ${childName}`} className="ui-v2-child-identity ui-v2-child-identity-button" onClick={onOpenChild} type="button">
          <span className="ui-v2-child-avatar"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} status={childAvatarStatus} name={childName} size="feed-header" /></span>
          <span className="ui-v2-child-copy"><Typography as="span" className="ui-v2-child-name" variant="memoryChild">{childName}</Typography><Typography as="span" className="ui-v2-child-subtitle" variant="memoryMeta">{childSubtitle}</Typography></span>
        </button> : <div className="ui-v2-child-identity">
          <span className="ui-v2-child-avatar"><ChildAvatar avatarCrop={childAvatarCrop} avatarUrl={childAvatarUrl} status={childAvatarStatus} name={childName} size="feed-header" /></span>
          <span className="ui-v2-child-copy"><Typography as="span" className="ui-v2-child-name" variant="memoryChild">{childName}</Typography><Typography as="span" className="ui-v2-child-subtitle" variant="memoryMeta">{childSubtitle}</Typography></span>
        </div>}
      </section>
    </div>
  )
}
