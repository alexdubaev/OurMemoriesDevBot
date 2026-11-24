"use client"

import {
  useEffect, useEffectEvent, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode, type Ref,
} from 'react'

import { cn } from '@/lib/utils'

import { createLiquidWater } from './liquid-glass-water'
import './liquid-glass-navbar.css'

/** Nimbus UI · Waterline by Guglielmo Giannattasio (MIT). */
export type NimbusFx = 'plane' | 'drop' | 'spin' | 'glow' | 'wave' | 'pop' | 'none'

export type LiquidNavItem = {
  label: string
  href?: string
  icon?: ReactNode
  fx?: NimbusFx
}

export type LiquidNavbarProps = {
  items?: LiquidNavItem[]
  defaultActive?: number
  active?: number
  onChange?: (index: number, item: LiquidNavItem) => void
  tone?: 'light' | 'dark'
  compact?: boolean
  sound?: boolean
  className?: string
  style?: CSSProperties
}

function icon(children: ReactNode) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

export const NimbusIcons = {
  home: icon(<><path d="M3.5 11.2 12 4l8.5 7.2" /><path d="M6 9.6V20h12V9.6" /><path className="nv-door" d="M10 20v-5h4v5Z" /></>),
  globe: icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 2.6 14.6 0 17M12 3.5c-2.6 2.4-2.6 14.6 0 17" /></>),
  plane: icon(<path d="M21 12.2 3.6 5.4l2.7 6.8-2.7 6.4L21 12.2Zm-14.7 0H13" />),
  drop: icon(<path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0C6 9.9 12 3.5 12 3.5Z" />),
  user: icon(<><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20c1.2-3.4 4-5 7.2-5s6 1.6 7.2 5" /></>),
}

const defaultItems: LiquidNavItem[] = [
  { label: 'Home', icon: NimbusIcons.home, fx: 'glow' },
  { label: 'Explore', icon: NimbusIcons.globe, fx: 'spin' },
  { label: 'Flights', icon: NimbusIcons.plane, fx: 'plane' },
  { label: 'Weather', icon: NimbusIcons.drop, fx: 'drop' },
  { label: 'Profile', icon: NimbusIcons.user, fx: 'wave' },
]

type Water = ReturnType<typeof createLiquidWater>

type SurfaceProps = {
  active: number
  children: ReactNode
  className?: string
  compact?: boolean
  enabled?: boolean
  fromIndex?: number
  onSettled?: () => void
  style?: CSSProperties
  tone?: 'light' | 'dark'
  waterRef?: Ref<Water | null>
}

export function LiquidNavbarSurface({
  active, children, className, compact, enabled = true, fromIndex, onSettled,
  style, tone = 'light', waterRef,
}: SurfaceProps) {
  return (
    <div className={cn(className, enabled && 'nimbus-nav')} data-compact={compact} data-tone={enabled ? tone : undefined} style={style}>
      {enabled ? <WaterLayer active={active} fromIndex={fromIndex} onSettled={onSettled} tone={tone} waterRef={waterRef} /> : null}
      {children}
    </div>
  )
}

function WaterLayer({ active, fromIndex, onSettled, tone = 'light', waterRef }: Pick<SurfaceProps, 'active' | 'fromIndex' | 'onSettled' | 'tone' | 'waterRef'>) {
  const filterId = useId()
  const glass = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drop = useRef<HTMLSpanElement>(null)
  const instance = useRef<Water>(null)
  const settled = useEffectEvent(() => { onSettled?.() })

  useLayoutEffect(() => {
    const layer = canvas.current
    if (!layer?.parentElement || !drop.current || !glass.current) return
    const chrome = /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent) && !/Firefox\//.test(navigator.userAgent)
    if (chrome && CSS.supports('backdrop-filter', 'url(#a)')) glass.current.dataset.refract = 'true'
    const water = createLiquidWater(layer.parentElement, layer, drop.current, () => settled())
    instance.current = water
    return () => {
      water.dispose()
      instance.current = null
    }
  }, [])

  useLayoutEffect(() => {
    instance.current?.select(active, fromIndex, tone)
  }, [active, fromIndex, tone])

  useImperativeHandle<Water | null, Water | null>(waterRef, () => instance.current, [])

  return (
    <>
      <svg className="nimbus-refract" width="0" height="0" aria-hidden="true">
        <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.02" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="60" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <span aria-hidden="true" className="nimbus-glass" ref={glass} style={{ '--n-refraction': `url(#${filterId})` } as CSSProperties} />
      <canvas aria-hidden="true" className="nimbus-water" ref={canvas} />
      <span aria-hidden="true" className="nimbus-drop" ref={drop} />
    </>
  )
}

function playPlip(ctx: AudioContext) {
  const time = ctx.currentTime
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.frequency.setValueAtTime(420 + Math.random() * 80, time)
  oscillator.frequency.exponentialRampToValueAtTime(1500, time + 0.07)
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(0.16, time + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16)
  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start(time)
  oscillator.stop(time + 0.18)
}

export function LiquidNavbar({
  items = defaultItems, defaultActive = 0, active, onChange, tone = 'light',
  compact, sound = false, className, style,
}: LiquidNavbarProps) {
  const [inner, setInner] = useState(defaultActive)
  const current = Math.max(0, Math.min(items.length - 1, active ?? inner))
  const [fx, setFx] = useState({ index: -1, sequence: 0 })
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([])
  const iconRefs = useRef<(HTMLSpanElement | null)[]>([])
  const water = useRef<Water>(null)
  const audio = useRef<AudioContext | null>(null)
  const timers = useRef(new Set<number>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(timer => window.clearTimeout(timer))
      pending.clear()
      void audio.current?.close().catch(() => undefined)
      audio.current = null
    }
  }, [])

  function plip() {
    if (!sound) return
    try {
      const Audio = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Audio) return
      playPlip(audio.current ??= new Audio())
    } catch {
      // The control still works when audio is unavailable.
    }
  }

  function select(index: number) {
    const item = items[index]
    if (!item) return
    setFx(previous => ({ index, sequence: previous.sequence + 1 }))
    plip()
    const box = iconRefs.current[index]?.getBoundingClientRect()
    if (box && item.fx === 'plane') water.current?.ripple(box.x + box.width / 2, box.y + box.height / 2, 0.6)
    if (box && item.fx === 'drop') {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer)
        water.current?.ripple(box.x + box.width / 2, box.y + box.height / 2, 1.4)
      }, 430)
      timers.current.add(timer)
    }
    if (index !== current) {
      if (active === undefined) setInner(index)
      onChange?.(index, item)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!items.length || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) return
    event.preventDefault()
    const next = (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    select(next)
    itemRefs.current[next]?.focus()
  }

  return (
    <nav aria-label="Main" onKeyDown={onKeyDown}>
      <LiquidNavbarSurface active={current} className={className} compact={compact} style={style} tone={tone} waterRef={water}>
        {items.map((item, index) => {
          const kind = item.fx ?? 'pop'
          const playing = fx.index === index && kind !== 'none'
          const props = {
            'aria-label': item.label,
            'aria-current': index === current ? 'page' as const : undefined,
            'data-liquid-nav-item': true,
            className: 'nimbus-item',
            onClick: () => select(index),
            ref: (element: HTMLButtonElement | HTMLAnchorElement | null) => { itemRefs.current[index] = element },
          }
          const content = <>
            {item.icon ? <span className="nv-ico" data-fx={playing ? kind : undefined} key={playing ? fx.sequence : 0} ref={element => { iconRefs.current[index] = element }}>{item.icon}</span> : null}
            <span className="nimbus-label">{item.label}</span>
          </>
          return item.href
            ? <a key={`${item.label}-${index}`} {...props} href={item.href}>{content}</a>
            : <button key={`${item.label}-${index}`} {...props} type="button">{content}</button>
        })}
      </LiquidNavbarSurface>
    </nav>
  )
}

export { LiquidNavbar as Component }
export default LiquidNavbar
