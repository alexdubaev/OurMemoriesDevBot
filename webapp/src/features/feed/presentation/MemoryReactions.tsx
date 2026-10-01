import type { MemoryReaction } from '@web-app-demo/contracts'
import { useEffect, useRef } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Typography } from '@/components/typography'
import type { ReactionHapticStyle } from '@/platform/reaction-haptics'

const reactionOptions: Array<{ value: MemoryReaction; emoji: string; label: string }> = [
  { value: 'heart', emoji: '❤️', label: 'Сердце' },
  { value: 'love', emoji: '🥰', label: 'Влюблённость' },
  { value: 'laugh', emoji: '😂', label: 'Смех' },
  { value: 'touched', emoji: '🥹', label: 'Тронут' },
  { value: 'wow', emoji: '😮', label: 'Удивление' },
  { value: 'clap', emoji: '👏', label: 'Аплодисменты' },
]

export function MemoryReactions({ counts, current, interactive, onSelect, open, point, onOpenChange, onHaptic, returnFocusRef }: {
  counts: Partial<Record<MemoryReaction, number>>
  current: MemoryReaction | null
  interactive: boolean
  onSelect: (reaction: MemoryReaction | null) => void
  open: boolean
  point: { x: number; y: number }
  onOpenChange: (open: boolean) => void
  onHaptic?: (style: ReactionHapticStyle) => void
  returnFocusRef: React.RefObject<HTMLElement | null>
}) {
  const firstChoice = useRef<HTMLButtonElement>(null)
  const used = reactionOptions.filter(({ value }) => (counts[value] ?? 0) > 0)
  useEffect(() => {
    if (open) requestAnimationFrame(() => { if (open) firstChoice.current?.focus({ preventScroll: true }) })
  }, [open])

  const select = (value: MemoryReaction) => {
    onHaptic?.('soft')
    onSelect(current === value ? null : value)
    onOpenChange(false)
  }

  return <>
    {used.length ? <div className="actions"><div aria-label={`Реакции: ${used.map(({ value, label }) => `${label} ${counts[value]}${current === value ? ', ваша реакция' : ''}`).join(', ')}`} className="memory-reactions" data-slot="memory-reactions" role="group">
      {used.map(({ value, emoji }) => <span className={`reaction-result${current === value ? ' is-mine' : ''}`} data-reaction={value} data-reaction-result="" key={value}>
        <Typography as="span" aria-hidden="true" className="reaction-result-emoji" variant="memoryMeta">{emoji}</Typography>
        <Typography as="span" className="reaction-result-count" variant="memoryMeta">{counts[value]}{current === value ? <span aria-hidden="true" className="reaction-own-dot" /> : null}</Typography>
      </span>)}
    </div></div> : null}
    {interactive ? <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverAnchor asChild><span aria-hidden="true" className="reaction-anchor" style={{ left: point.x, top: point.y }} /></PopoverAnchor>
      <PopoverContent align="center" aria-label="Выбрать реакцию" className="reaction-picker" collisionPadding={{ top: 12, right: 12, bottom: bottomCollisionPadding(), left: 12 }} onCloseAutoFocus={(event) => { event.preventDefault(); if (interactive && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }} onEscapeKeyDown={() => onOpenChange(false)} onOpenAutoFocus={(event) => event.preventDefault()} onPointerDownOutside={() => onOpenChange(false)} side="top" sideOffset={14}>
        <div aria-label="Реакции" className="reaction-picker-options" role="group" onKeyDown={(event) => {
          const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const index = choices.indexOf(event.target as HTMLButtonElement)
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); choices[(index + 1) % choices.length]?.focus() }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); choices[(index - 1 + choices.length) % choices.length]?.focus() }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (event.target as HTMLButtonElement).click() }
        }}>{reactionOptions.map(({ value, emoji, label }, index) => <button aria-label={`${label}${current === value ? ', выбрана' : ''}`} aria-pressed={current === value} className={`reaction-choice${current === value ? ' is-selected' : ''}`} key={value} onClick={() => select(value)} ref={index === 0 ? firstChoice : undefined} title={label} type="button"><Typography as="span" className="reaction-choice-emoji" variant="memoryMeta">{emoji}</Typography>{current === value ? <Typography as="span" aria-hidden="true" className="reaction-choice-check" variant="memoryMeta">✓</Typography> : null}</button>)}</div>
      </PopoverContent>
    </Popover> : null}
  </>
}

function bottomCollisionPadding() {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return 88
  const raw = getComputedStyle(document.querySelector('[data-memoly-feed]') ?? document.documentElement).getPropertyValue('--host-inset-bottom')
  const inset = Number.parseFloat(raw)
  return 88 + (Number.isFinite(inset) ? inset : 0)
}
