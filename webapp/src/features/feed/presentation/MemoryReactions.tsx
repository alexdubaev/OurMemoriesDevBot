import type { MemoryReaction } from '@web-app-demo/contracts'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Typography } from '@/components/typography'

const reactionOptions: Array<{ value: MemoryReaction; emoji: string; label: string }> = [
  { value: 'heart', emoji: '❤️', label: 'Сердце' },
  { value: 'love', emoji: '🥰', label: 'Влюблённость' },
  { value: 'laugh', emoji: '😂', label: 'Смех' },
  { value: 'touched', emoji: '🥹', label: 'Тронут' },
  { value: 'wow', emoji: '😮', label: 'Удивление' },
  { value: 'clap', emoji: '👏', label: 'Аплодисменты' },
]

export function MemoryReactions({ counts, current, interactive, onSelect }: {
  counts: Partial<Record<MemoryReaction, number>>
  current: MemoryReaction | null
  interactive: boolean
  onSelect: (reaction: MemoryReaction | null) => void
}) {
  const [open, setOpen] = useState(false)
  const used = reactionOptions.filter(({ value }) => (counts[value] ?? 0) > 0)
  const visible = used.slice(0, 4)
  const hidden = used.slice(4)
  const select = (value: MemoryReaction) => {
    onSelect(current === value ? null : value)
    setOpen(false)
  }
  return <div className="memory-reactions" data-slot="memory-reactions">
    {!visible.some(({ value }) => value === 'heart') ? <button aria-label={current === 'heart' ? 'Убрать реакцию ❤️' : 'Поставить реакцию ❤️'} aria-pressed={current === 'heart'} className={`memory-like${current === 'heart' ? ' is-liked' : ''}`} disabled={!interactive} onClick={() => onSelect(current === 'heart' ? null : 'heart')} type="button">
      <Typography as="span" aria-hidden="true" className="reaction-emoji" variant="memoryMeta">❤️</Typography>
    </button> : null}
    {visible.map(({ value, emoji, label }) => <button aria-label={`${label}: ${counts[value]}${current === value ? ', выбрано' : ''}`} aria-pressed={current === value} className={`reaction-pill${current === value ? ' is-selected' : ''}`} disabled={!interactive} key={value} onClick={() => select(value)} type="button"><Typography as="span" aria-hidden="true" className="reaction-emoji" variant="memoryMeta">{emoji}</Typography><Typography as="span" variant="memoryMeta">{counts[value]}</Typography></button>)}
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild><button aria-label={hidden.length ? `Ещё реакции: ${hidden.reduce((sum, item) => sum + (counts[item.value] ?? 0), 0)}${hidden.some(({ value }) => value === current) ? ', содержит выбранную реакцию' : ''}` : 'Выбрать реакцию'} className={`${hidden.length ? 'reaction-more' : 'reaction-picker-trigger'}${hidden.some(({ value }) => value === current) ? ' is-selected' : ''}`} disabled={!interactive} type="button"><Typography as="span" variant="memoryMeta">{hidden.length ? `+${hidden.length}` : '+'}</Typography></button></PopoverTrigger>
      <PopoverContent align="start" aria-label="Выбрать реакцию" className="reaction-picker" side="top">
        <ReactionChoices current={current} onSelect={select} />
      </PopoverContent>
    </Popover>
  </div>
}

function ReactionChoices({ current, onSelect }: { current: MemoryReaction | null; onSelect: (value: MemoryReaction) => void }) {
  return <div aria-label="Реакции" className="reaction-picker-options" role="group">{reactionOptions.map(({ value, emoji, label }) => <button aria-label={label} aria-pressed={current === value} className={`reaction-choice${current === value ? ' is-selected' : ''}`} key={value} onClick={() => onSelect(value)} title={label} type="button"><Typography as="span" variant="memoryMeta">{emoji}</Typography></button>)}</div>
}
