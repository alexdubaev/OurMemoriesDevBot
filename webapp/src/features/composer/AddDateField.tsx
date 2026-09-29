import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'

export function AddDateField({ disabled = false, id, label, onChange, today, value }: {
  disabled?: boolean
  id: string
  label: string
  onChange: (value: string) => void
  today: string
  value: string
}) {
  const date = new Date(`${value}T12:00:00Z`)
  const text = Number.isNaN(date.getTime()) ? 'Выберите дату' : new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date).replace(/ г\.$/, '')

  return <label className="memoly-add-date" htmlFor={id}>
    <WebpIcon decorative name="calendar" size={20} />
    <Typography as="span" className="memoly-add-date-text" variant="memoryBodyMedium">{value === today ? `Сегодня, ${text}` : text}</Typography>
    <WebpIcon decorative name="chevron" size={17} />
    <input aria-label={label} disabled={disabled} id={id} max={today} onChange={(event) => onChange(event.currentTarget.value)} type="date" value={value} />
  </label>
}
