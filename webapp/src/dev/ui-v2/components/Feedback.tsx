import { Button, Icon } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
export function InlineNotice({ children, error = false }: { children: string; error?: boolean }) { return <div className={'v2-notice' + (error ? ' v2-notice--error' : '')} role={error ? 'alert' : 'status'}><Typography variant="meta">{children}</Typography></div> }
export function LoadingState({ label = 'Загружаем воспоминания…' }: { label?: string }) {
  return <div className="v2-state" role="status"><span className="v2-spinner" aria-hidden="true" /><Typography>{label}</Typography><div className="v2-skeleton" aria-hidden="true" /><div className="v2-skeleton v2-skeleton--short" aria-hidden="true" /></div>
}
export function EmptyState({ title, body, action, onPress }: { title: string; body: string; action?: string; onPress?: () => void }) {
  return <section className="v2-state"><span className="v2-state-mark"><Icon name="photo" size={32} /></span><Typography as="h2" variant="title">{title}</Typography><Typography>{body}</Typography>{action && <Button onPress={onPress}>{action}</Button>}</section>
}
export function ErrorState({ title = 'Не удалось загрузить', body = 'Проверьте соединение и повторите попытку.', onRetry }: { title?: string; body?: string; onRetry: () => void }) {
  return <section className="v2-state" role="alert"><span className="v2-state-mark"><Icon name="warning" size={32} /></span><Typography as="h2" variant="title">{title}</Typography><Typography>{body}</Typography><Button onPress={onRetry}>Повторить</Button></section>
}
