import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { Button } from '@/components/ui/button'

export function InlineError({ onRetry, nextPage = false }: { onRetry: () => void; nextPage?: boolean }) {
  return (
    <section
      className="feed-error-state flex min-w-0 items-center gap-3 rounded-[var(--radius-field)] bg-card p-[var(--layout-card-padding)] shadow-[var(--shadow-card)]"
      data-slot="inline-error"
      role="alert"
    >
      <WebpIcon decorative name="warning" size={24} state="active" />
      <div className="min-w-0 flex-1">
        <Typography as="h2" variant="bodySm">{nextPage ? 'Не удалось загрузить ещё' : 'Не удалось обновить ленту'}</Typography>
        <Typography variant="bodySm">Проверьте соединение и повторите попытку.</Typography>
      </div>
      <Button className="min-h-11 shrink-0" onClick={onRetry} type="button" variant="ghost">
        <WebpIcon decorative data-icon="inline-start" name="retry" size={20} state="active" />
        <Typography variant="controlXs">Повторить</Typography>
      </Button>
    </section>
  )
}
