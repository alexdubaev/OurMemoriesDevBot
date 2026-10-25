import { Typography } from '@/components/typography'
import type { ChildFilter, ChildFilterChip } from '../child-filter'

/** «Все · Лиля · Миша · Без отметки» under the header; each chip is a toggle with `aria-pressed`. */
export function ChildFilterChips({ chips, value, onChange }: { chips: readonly ChildFilterChip[]; value: ChildFilter; onChange: (next: ChildFilter) => void }) {
  if (chips.length === 0) return null
  return <div aria-label="Чьи воспоминания показать" className="feed-child-chips" data-slot="feed-child-filters" role="group">
    {chips.map((chip) => <button aria-pressed={chip.value === value} className="feed-child-chip" key={chip.value ?? 'all'} onClick={() => { if (chip.value !== value) onChange(chip.value) }} type="button">
      <Typography as="span" variant="memoryFilter">{chip.label}</Typography>
    </button>)}
  </div>
}
