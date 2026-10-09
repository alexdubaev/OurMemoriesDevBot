import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { IconButton } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
type ModalProps = { title: string; children: ReactNode; onClose: () => void; variant?: 'sheet' | 'dialog' | 'viewer' }
export function Modal({ title, children, onClose, variant = 'sheet' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const close = useEffectEvent(onClose)
  // Keep the original trigger for restoration, but focus every replacement dialog.
  useEffect(() => { panel.current?.focus() }, [title, variant])
  useEffect(() => {
    const element = panel.current
    const scroller = element?.closest('.v2-screen')?.querySelector<HTMLElement>('.v2-scroll')
    const oldOverflow = scroller?.style.overflow ?? ''
    if (scroller) scroller.style.overflow = 'hidden'
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
      if (e.key !== 'Tab') return
      const items = Array.from(element?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') ?? []).filter(item => item.getClientRects().length > 0)
      const first = items[0], last = items[items.length - 1]
      if (!first) { e.preventDefault(); element?.focus(); return }
      const outside = !element?.contains(document.activeElement) || document.activeElement === element
      if (e.shiftKey && (document.activeElement === first || outside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || outside)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard, true)
    return () => { document.removeEventListener('keydown', keyboard, true); if (scroller) scroller.style.overflow = oldOverflow; returnFocus?.focus({ preventScroll: true }) }
  }, [returnFocus])
  return <div className={'v2-modal-backdrop v2-modal-backdrop--' + variant} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className={'v2-modal v2-modal--' + variant} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
      <header className="v2-modal-header"><Typography as="h2" variant="section" id={titleId}>{title}</Typography><IconButton name="close" label="Закрыть" onPress={onClose} /></header>{children}
    </div>
  </div>
}
