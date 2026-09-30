import type { MouseEvent } from 'react'

import { Typography } from '@/components/typography'

type NoteStoryPresentationProps = {
  body: string
  interactive: boolean
  onOpen: () => void
}

export function NoteStoryPresentation({ body, interactive, onOpen }: NoteStoryPresentationProps) {
  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    const selection = event.currentTarget.ownerDocument.getSelection()
    const selectionIsInsideNote = selection
      && !selection.isCollapsed
      && selection.anchorNode
      && selection.focusNode
      && event.currentTarget.contains(selection.anchorNode)
      && event.currentTarget.contains(selection.focusNode)

    if (event.detail !== 0 && selectionIsInsideNote) {
      event.preventDefault()
      return
    }

    onOpen()
  }

  const contents = <Typography as="span" className="memoly-note-gradient__text" variant="memoryBody">{body}</Typography>

  if (!interactive) {
    return <Typography asChild className="memoly-note-gradient" variant="memoryBody"><div data-memoly-note-gradient="">{contents}</div></Typography>
  }

  return (
    <Typography asChild className="memoly-note-gradient" variant="memoryBody">
      <button aria-label={`Открыть заметку: ${body}`} data-memoly-note-gradient="" onClick={handleOpen} type="button">{contents}</button>
    </Typography>
  )
}
