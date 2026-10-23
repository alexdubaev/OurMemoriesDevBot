import type { ChildDto } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import { toggleChildId } from './child-tags'
import './ChildTagPicker.css'

/** «Кто на этом воспоминании»: shown only in a family with two or more children. None is a valid answer. */
export function ChildTagPicker({ childOptions, selected, onChange, disabled = false }: { childOptions: readonly ChildDto[]; selected: readonly string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  if (childOptions.length < 2) return null
  return <fieldset className="memoly-child-tag-picker" data-slot="child-tag-picker" disabled={disabled}>
    <legend><Typography as="span" variant="memoryButton">Кто на этом воспоминании</Typography></legend>
    <div className="memoly-child-tag-options">
      {childOptions.map((child) => {
        const pressed = selected.includes(child.id)
        return <button aria-pressed={pressed} className="memoly-child-tag-option" key={child.id} onClick={() => onChange(toggleChildId(selected, child.id, childOptions))} type="button">
          <span aria-hidden="true" className="memoly-child-tag-mark" />
          <Typography as="span" variant="memoryFilter">{child.name}</Typography>
        </button>
      })}
    </div>
    <Typography as="p" className="memoly-child-tag-hint" variant="memoryMeta">{selected.length ? 'Воспоминание появится на страницах выбранных детей и в общей ленте.' : 'Без отметки воспоминание будет только в общей ленте.'}</Typography>
  </fieldset>
}
