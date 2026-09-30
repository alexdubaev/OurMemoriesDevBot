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

  const contents = (
    <>
      <span aria-hidden="true" className="note-story-decoration">
        <img alt="" className="note-story-sun" height="76" src="/assets/feed-notes/note-sun.webp" width="80" />
        <img alt="" className="note-story-sprig" height="100" src="/assets/feed-notes/note-leaf-sprig.webp" width="76" />
      </span>
      <Typography as="span" className="note-story-text" variant="memoryBody">{body}</Typography>
    </>
  )

  if (!interactive) {
    return <Typography asChild className="note-story-panel" variant="memoryBody"><div>{contents}</div></Typography>
  }

  return (
    <Typography asChild className="note-story-panel" variant="memoryBody">
      <button aria-label={`Открыть заметку: ${body}`} onClick={handleOpen} type="button">{contents}</button>
    </Typography>
  )
}
