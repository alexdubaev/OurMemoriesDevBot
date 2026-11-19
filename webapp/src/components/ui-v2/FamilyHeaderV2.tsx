import type { ReactNode } from 'react'
import type { ChildDto } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import { ChildAvatar } from '@/features/family'
import type { MemolyTheme } from '@/features/theme'
import { childCountLabel } from './child-count'

import './ChildHeaderV2.css'
import './FamilyHeaderV2.css'

export type FamilyHeaderV2Props = {
  familyName: string
  /** Children in server order (oldest first). */
  childList: readonly ChildDto[]
  /** Live avatar of one child; a letter avatar is shown without it. */
  renderChildAvatar?: (child: ChildDto) => ReactNode
  /** Tapping an avatar opens that child (the feed: the child's page). Without it avatars are not buttons. */
  onSelectChild?: (childId: string) => void
  selectChildLabel?: (child: ChildDto) => string
  onAllFamilies?: () => void
  onOpenSettings?: () => void
  mode: 'feed' | 'family'
  theme: MemolyTheme
}

/** The header of a family with two or more children: the family name and every child's avatar. */
export function FamilyHeaderV2({ familyName, childList, renderChildAvatar, onSelectChild, selectChildLabel = (child) => `Открыть страницу ребёнка: ${child.name}`, onAllFamilies, onOpenSettings, mode, theme }: FamilyHeaderV2Props) {
  const renderAvatar = (child: ChildDto) => renderChildAvatar?.(child) ?? <ChildAvatar avatarCrop={child.avatarCrop} avatarUrl={null} name={child.name} size="feed-header" />
  return (
    <div className="memoly-child-header-frame ui-v2-child-header-frame">
      <section aria-label="Семья" className="ui-v2-child-header ui-v2-family-header" data-child-header-mode={mode} data-family-header="true" data-theme={theme} data-ui-version="v2">
        <div className="ui-v2-header-actions">
          <Typography as="span" className="astryx-header-brand" variant="memoryScreen">memoLy</Typography>
          {onAllFamilies ? <button aria-label="Мои семьи" className="ui-v2-families-action" onClick={onAllFamilies} type="button"><Typography as="span" className="ui-v2-families-label" variant="memoryButton">Мои семьи</Typography></button> : <span aria-hidden="true" />}
          {onOpenSettings ? <button aria-label="Настройки" className="ui-v2-settings" onClick={() => onOpenSettings()} type="button"><Typography as="span" variant="memoryButton">Настройки</Typography></button> : <span aria-hidden="true" />}
        </div>
        <div className="ui-v2-family-identity">
          <Typography as="h2" className="ui-v2-child-name ui-v2-family-name" variant="memoryChild">{familyName}</Typography>
          <Typography as="p" className="ui-v2-child-subtitle" variant="memoryMeta">{childCountLabel(childList.length)}</Typography>
        </div>
        <ul aria-label="Дети" className="ui-v2-family-children">
          {childList.map((child) => <li key={child.id}>
            {onSelectChild
              ? <button aria-label={selectChildLabel(child)} className="ui-v2-family-child" onClick={() => onSelectChild(child.id)} type="button"><span className="ui-v2-family-child-avatar">{renderAvatar(child)}</span><Typography aria-hidden="true" as="span" className="ui-v2-family-child-name" variant="memoryMeta">{child.name}</Typography></button>
              : <span className="ui-v2-family-child"><span className="ui-v2-family-child-avatar">{renderAvatar(child)}</span><Typography as="span" className="ui-v2-family-child-name" variant="memoryMeta">{child.name}</Typography></span>}
          </li>)}
        </ul>
      </section>
    </div>
  )
}
