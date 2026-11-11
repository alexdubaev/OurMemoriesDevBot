/* eslint-disable typographyPolicy/use-typography-component -- Pressable forwards ReactNode content, including images and composed text, without owning typography. */
import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Typography } from './Typography'
import { tokens } from '../tokens/design-tokens'
import backIcon from '../assets/back.webp'
import checkIcon from '../assets/check.webp'
type PressableProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { onPress?: () => void; onLongPress?: () => void; onFeedback?: (kind: 'selection' | 'hold') => void }
export function Pressable({ onPress, onLongPress, onFeedback, className = '', children, ...props }: PressableProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const origin = useRef<{ x: number; y: number } | null>(null)
  function clear() { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <button {...props} className={'v2-pressable ' + className} type={props.type ?? 'button'}
    onPointerDown={(e) => {
      if (!onLongPress || props.disabled || e.button !== 0) return
      clear(); held.current = false; origin.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => { held.current = true; onFeedback?.('hold'); onLongPress() }, tokens.motion.hold)
    }}
    onPointerMove={(e) => { if (origin.current && Math.abs(e.clientX - origin.current.x) + Math.abs(e.clientY - origin.current.y) > tokens.targets.minimum / 4) clear() }}
    onPointerUp={clear} onPointerCancel={clear} onPointerLeave={clear}
    onContextMenu={(e) => { if (onLongPress) e.preventDefault() }}
    onClick={() => { if (held.current) { held.current = false; return }; onFeedback?.('selection'); onPress?.() }}>{children}</button>
}
export function Button({ children, tone = 'primary', ...props }: PressableProps & { tone?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <Pressable {...props} className={'v2-button v2-button--' + tone + ' ' + (props.className ?? '')}><Typography as="span" variant="person">{children}</Typography></Pressable>
}
export type IconName = 'back' | 'close' | 'family' | 'feed' | 'plus' | 'more' | 'gear' | 'photo' | 'note' | 'voice' | 'video' | 'play' | 'pause' | 'chevron' | 'heart' | 'lock' | 'warning' | 'check' | 'edit' | 'copy' | 'user' | 'fullscreen'
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  // Reuse licensed repository WebP RGBA assets. No new icon library or SVG.
  const mapped = name === 'feed' ? 'home' : name
  const source = name === 'back' ? backIcon : name === 'check' ? checkIcon : '/assets/icons/' + mapped + '-default@3x.webp'
  return <img alt="" aria-hidden="true" className="v2-icon" src={source} width={size} height={size} />
}
export function IconButton({ name, label, ...props }: PressableProps & { name: IconName; label: string }) {
  return <Pressable {...props} aria-label={label} className={'v2-icon-button ' + (props.className ?? '')}><Icon name={name} /></Pressable>
}
export function Badge({ children }: { children: ReactNode }) { return <Typography as="span" className="v2-badge" variant="caption">{children}</Typography> }
export function Avatar({ name, src, large = false }: { name: string; src?: string; large?: boolean }) {
  return <span className={'v2-avatar' + (large ? ' v2-avatar--large' : '')}>{src ? <img alt="" src={src} /> : <Typography as="span" variant="person">{name.slice(0, 1)}</Typography>}</span>
}
