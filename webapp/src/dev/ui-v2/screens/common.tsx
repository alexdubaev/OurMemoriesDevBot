import { IconButton } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import type { ReactNode } from 'react'
export function TopBar({ title, onBack, action }: { title: string; onBack: () => void; action?: ReactNode }) {
  return <header className="v2-topbar"><IconButton name="back" label="Назад" onPress={onBack} /><Typography as="h1" variant="section">{title}</Typography>{action ?? <span className="v2-hero-action-spacer" />}</header>
}
export function PageContent({ children }: { children: ReactNode }) { return <div className="v2-page-content v2-stack">{children}</div> }
