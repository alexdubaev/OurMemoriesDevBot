import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'
import { uiCopy } from '@/content/ui-copy'

export function InlineError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      className="flex min-w-0 items-center gap-3 rounded-[var(--radius-field)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]"
      data-slot="inline-error"
      role="alert"
    >
      <WebpIcon decorative name="warning" size={24} state="active" />
      <Typography className="min-w-0 flex-1" variant="bodySm">
        {uiCopy['error.refresh']}
      </Typography>
      <Button className="min-h-11 shrink-0" onClick={onRetry} type="button" variant="ghost">
        <WebpIcon decorative data-icon="inline-start" name="retry" size={20} state="active" />
        <Typography variant="controlXs">{uiCopy['common.retry']}</Typography>
      </Button>
    </section>
  )
}
