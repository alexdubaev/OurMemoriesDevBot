/* eslint-disable typographyPolicy/use-typography-component -- same static markup and classes as the member rows beside it. */
import type { ChildDto } from '@web-app-demo/contracts'
import type { ReactNode } from 'react'

import { ChildAvatar, feedChildSubtitle, hasManyChildren } from '@/features/family'

/**
 * Children block of the «Семья» tab. A one-child family sees nothing here except the owner's
 * «Добавить ребёнка»; with two or more children the profiles are listed, tappable for the owner only.
 */
export function FamilyChildrenSection({ childList, canEdit, timezone, onAddChild, onEditChild, renderAvatar }: {
  childList: readonly ChildDto[]
  canEdit: boolean
  timezone: string
  onAddChild?: () => void
  onEditChild: (childId: string) => void
  renderAvatar?: (child: ChildDto) => ReactNode
}) {
  const many = hasManyChildren(childList)
  if (!many && !onAddChild) return null
  return <section aria-label="Дети" className="family-children" data-slot="family-children">
    {many ? <>
      <div className="family-section-head"><h2>Дети</h2><span className="family-count">{childList.length}</span></div>
      <div className="family-list">{childList.map((child) => <FamilyChildRow key={child.id} canEdit={canEdit} child={child} onOpen={onEditChild} renderAvatar={renderAvatar} timezone={timezone} />)}</div>
    </> : null}
    {onAddChild ? <button className="family-invite-btn family-add-child-btn" onClick={onAddChild} type="button"><span className="family-invite-plus">+</span><span>Добавить ребёнка</span></button> : null}
  </section>
}

function FamilyChildRow({ child, canEdit, timezone, renderAvatar, onOpen }: { child: ChildDto; canEdit: boolean; timezone: string; renderAvatar?: (child: ChildDto) => ReactNode; onOpen: (childId: string) => void }) {
  const avatar = renderAvatar?.(child) ?? <ChildAvatar avatarCrop={child.avatarCrop} avatarUrl={null} name={child.name} size="family-row" />
  const copy = <><span className="family-child-avatar">{avatar}</span><span className="family-member-copy"><strong>{child.name}</strong><span>{feedChildSubtitle(child.birthDate, timezone)}</span></span></>
  return canEdit
    ? <button aria-label={`Открыть профиль ребёнка: ${child.name}`} className="family-member-row family-child-row" onClick={() => onOpen(child.id)} type="button">{copy}<span aria-hidden="true" className="family-role">›</span></button>
    : <div className="family-member-row family-child-row" role="group">{copy}<span aria-hidden="true" /></div>
}
