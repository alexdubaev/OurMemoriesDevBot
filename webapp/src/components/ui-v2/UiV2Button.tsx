import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Typography } from '@/components/typography'
import { readUiVersion } from '@/features/ui-version'

export type UiV2ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  children: ReactNode
  className?: string
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

/** Shared v2 button surface; feature styles should control placement only. */
export function UiV2Button({ children, className = '', variant = 'secondary', ...props }: UiV2ButtonProps) {
  const isV2 = readUiVersion() === 'v2'
  const modeClass = isV2 ? `ui-v2-button ui-v2-button--${variant}` : ''
  // Keep the legacy button's exact child markup while the v2 branch uses the shared type scale.
  // eslint-disable-next-line typographyPolicy/use-typography-component
  return <button className={[modeClass, className].filter(Boolean).join(' ')} {...props}>{isV2 ? <Typography as="span">{children}</Typography> : children}</button>
}
