import { WebpIcon } from '@/components/WebpIcon'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { uiCopy } from '@/content/ui-copy'

export function EmptyState({
  mode,
  onOpenBot,
}: {
  mode: 'full' | 'viewer'
  onOpenBot?: () => void
}) {
  return (
    <Empty className="min-h-[448px] gap-6 px-0 py-12" data-slot="feed-empty">
      <EmptyHeader className="max-w-[22rem] gap-4">
        <EmptyMedia className="size-16 rounded-full bg-accent" variant="default">
          <WebpIcon decorative name="photo" size={32} state="active" />
        </EmptyMedia>
        <EmptyTitle className="max-w-[20rem]">
          <Typography as="span" variant="memoryEmptyTitle">
            {uiCopy['feed.empty.title']}
          </Typography>
        </EmptyTitle>
        <EmptyDescription className="max-w-[22rem]">
          <Typography as="span" variant="memoryBody">
            {mode === 'viewer' ? uiCopy['feed.empty.viewer'] : uiCopy['feed.empty.body']}
          </Typography>
        </EmptyDescription>
      </EmptyHeader>
      {mode === 'full' ? (
        <EmptyContent>
          <Button
            className="min-h-[var(--layout-primary-height)] w-full rounded-[var(--radius-field)]"
            onClick={onOpenBot}
            type="button"
          >
            <Typography variant="memoryButton">{uiCopy['common.openBot']}</Typography>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  )
}
