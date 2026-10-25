/* eslint-disable typographyPolicy/use-typography-component -- layout slots accept composed ReactNode surfaces, never raw product text. */
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
export function Stack({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={'v2-stack ' + className} {...props} /> }
export function Row({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={'v2-row ' + className} {...props} /> }
export function Surface({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={'v2-surface ' + className}>{children}</section> }
export function Divider() { return <hr className="v2-divider" /> }
export function Screen({ children, navigation, overlay, style }: { children: ReactNode; navigation?: ReactNode; overlay?: ReactNode; style?: CSSProperties }) {
  return <div className="v2-screen" style={style}><main className="v2-scroll" inert={Boolean(overlay)} aria-hidden={overlay ? true : undefined}>{children}</main><div inert={Boolean(overlay)}>{navigation}</div>{overlay}</div>
}
