import type { MemoryReaction } from '@web-app-demo/contracts'
import { useEffect, useRef } from 'react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { UiV2Button } from '@/components/ui-v2/UiV2Button'
import { readUiVersion } from '@/features/ui-version'
import type { ReactionHapticStyle } from '@/platform/reaction-haptics'

const reactionOptions: Array<{ value: MemoryReaction; emoji: string; label: string }> = [
  { value: 'heart', emoji: '❤️', label: 'Сердце' },
  { value: 'love', emoji: '🥰', label: 'Влюблённость' },
  { value: 'laugh', emoji: '😂', label: 'Смех' },
  { value: 'touched', emoji: '🥹', label: 'Тронут' },
  { value: 'wow', emoji: '😮', label: 'Удивление' },
  { value: 'clap', emoji: '👏', label: 'Аплодисменты' },
]

export function MemoryReactions({ counts, current, interactive, onSelect, open, point, onOpenChange, onOpenFromTrigger, onHaptic, returnFocusRef, onComments, commentCount }: {
  counts: Partial<Record<MemoryReaction, number>>
  current: MemoryReaction | null
  interactive: boolean
  onSelect: (reaction: MemoryReaction | null) => void
  open: boolean
  point: { x: number; y: number }
  onOpenChange: (open: boolean) => void
  onOpenFromTrigger: (point: { x: number; y: number }) => void
  onHaptic?: (style: ReactionHapticStyle) => void
  returnFocusRef: React.RefObject<HTMLElement | null>
  onComments?: () => void
  commentCount?: number
}) {
  const firstChoice = useRef<HTMLButtonElement>(null)
  const uiV2 = readUiVersion() === 'v2'
  const triggerLabel = uiV2 ? 'Добавить реакцию' : 'Откликнуться'
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
    {uiV2 && interactive ? <footer className="memory-reaction-footer" data-slot="memory-reaction-footer">
      {used.length ? <div aria-label={`Реакции: ${used.map(({ value, label }) => `${label} ${counts[value]}${current === value ? ', ваша реакция' : ''}`).join(', ')}`} className="memory-reactions" data-slot="memory-reactions" role="group">
      {used.map(({ value, emoji }) => <span className={`reaction-result${current === value ? ' is-mine' : ''}`} data-reaction={value} data-reaction-result="" key={value}>
        <Typography as="span" aria-hidden="true" className="reaction-result-emoji" variant="memoryMeta">{emoji}</Typography>
        <Typography as="span" className="reaction-result-count" variant="memoryMeta">{counts[value]}{current === value ? <span aria-hidden="true" className="reaction-own-dot" /> : null}</Typography>
      </span>)}
      </div> : <span aria-hidden="true" className="memory-reactions-empty" />}
      {onComments ? <CommentAction count={commentCount} onClick={onComments} /> : null}
      <UiV2Button aria-label={triggerLabel} className="ui-v2-reaction-button" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onOpenFromTrigger({ x: rect.left + rect.width / 2, y: rect.top })
      }} type="button" variant="quiet"><WebpIcon decorative monochrome name="heart" size={18} /><Typography as="span" variant="memoryMeta">{triggerLabel}</Typography></UiV2Button>
    </footer> : null}
    {!uiV2 && (used.length || onComments) ? <div className="actions">
      {used.length ? <div aria-label={`Реакции: ${used.map(({ value, label }) => `${label} ${counts[value]}${current === value ? ', ваша реакция' : ''}`).join(', ')}`} className="memory-reactions" data-slot="memory-reactions" role="group">
        {used.map(({ value, emoji }) => <span className={`reaction-result${current === value ? ' is-mine' : ''}`} data-reaction={value} data-reaction-result="" key={value}><Typography as="span" aria-hidden="true" className="reaction-result-emoji" variant="memoryMeta">{emoji}</Typography><Typography as="span" className="reaction-result-count" variant="memoryMeta">{counts[value]}{current === value ? <span aria-hidden="true" className="reaction-own-dot" /> : null}</Typography></span>)}
      </div> : null}
      {onComments ? <CommentAction count={commentCount} onClick={onComments} /> : null}
    </div> : null}
    {interactive ? <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverAnchor asChild><span aria-hidden="true" className="reaction-anchor" style={{ left: point.x, top: point.y }} /></PopoverAnchor>
      <PopoverContent align="center" aria-label="Выбрать реакцию" className="reaction-picker" collisionPadding={collisionPadding()} onCloseAutoFocus={(event) => { event.preventDefault(); if (interactive && returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }} onEscapeKeyDown={() => onOpenChange(false)} onOpenAutoFocus={(event) => event.preventDefault()} onPointerDownOutside={() => onOpenChange(false)} side="top" sideOffset={14}>
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

function CommentAction({ count, onClick }: { count?: number; onClick: () => void }) {
  const label = count === undefined ? 'Открыть комментарии' : `Открыть комментарии, ${count}`
  return <button aria-label={label} className="comments-entry" onClick={onClick} type="button"><WebpIcon decorative monochrome name="comments" size={22} />{count && count > 0 ? <Typography as="span" aria-hidden="true" variant="memoryMeta">{count}</Typography> : null}</button>
}

function collisionPadding() {
  const defaults = { top: 12, right: 12, bottom: 88, left: 12 }
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return defaults
  const surface = document.querySelector('[data-memoly-feed]') ?? document.documentElement
  const styles = getComputedStyle(surface)
  const inset = (side: 'top' | 'right' | 'bottom' | 'left') => {
    const hostInset = Number.parseFloat(styles.getPropertyValue(`--host-inset-${side}`))
    const safeAreaInset = Number.parseFloat(styles.getPropertyValue(`--reaction-safe-inset-${side}`))
    const finiteNonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
    return Math.max(finiteNonnegative(hostInset), finiteNonnegative(safeAreaInset))
  }
  return { top: defaults.top + inset('top'), right: defaults.right + inset('right'), bottom: defaults.bottom + inset('bottom'), left: defaults.left + inset('left') }
}
