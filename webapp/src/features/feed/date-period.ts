export type FeedDatePeriod =
  | { mode: 'year'; year: number }
  | { mode: 'month'; year: number; month: number }
  | { mode: 'range'; fromYear: number; fromMonth: number; toYear: number; toMonth: number }
  | { mode: 'day'; date: string }

export type FeedDateBounds = { occurredFrom: string; occurredBefore: string }

const civilDateFormatters = new Map<string, Intl.DateTimeFormat>()

export function feedDateBounds(period: FeedDatePeriod, timezone: string): FeedDateBounds {
  let start: string
  let end: string
  if (period.mode === 'year') {
    start = `${period.year}-01-01`; end = `${period.year + 1}-01-01`
  } else if (period.mode === 'month') {
    start = civilDate(period.year, period.month, 1); end = addMonths(period.year, period.month, 1)
  } else if (period.mode === 'range') {
    if (period.fromYear * 12 + period.fromMonth > period.toYear * 12 + period.toMonth) throw new RangeError('Начало периода должно быть раньше конца')
    start = civilDate(period.fromYear, period.fromMonth, 1); end = addMonths(period.toYear, period.toMonth, 1)
  } else {
    start = period.date; const date = parseCivilDate(period.date)
    end = civilDate(...nextDay(date.year, date.month, date.day))
  }
  const occurredFrom = zonedMidnight(start, timezone)
  const occurredBefore = zonedMidnight(end, timezone)
  if (occurredFrom >= occurredBefore) throw new RangeError('Эта дата отсутствует в часовом поясе семьи')
  return { occurredFrom, occurredBefore }
}

export function isCivilDateAvailable(date: string, timezone: string) {
  try {
    feedDateBounds({ mode: 'day', date }, timezone)
    return true
  } catch {
    return false
  }
}

export function feedDatePeriodLabel(period: FeedDatePeriod) {
  const month = (year: number, value: number) => new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, value - 1, 1)))
  if (period.mode === 'year') return String(period.year)
  if (period.mode === 'month') return month(period.year, period.month)
  if (period.mode === 'range') return `${month(period.fromYear, period.fromMonth)} — ${month(period.toYear, period.toMonth)}`
  const { year, month: value, day } = parseCivilDate(period.date)
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, value - 1, day)))
}

export function familyCivilDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (part: string) => parts.find(({ type }) => type === part)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function calendarCivilDate(date: Date) {
  return civilDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function zonedMidnight(date: string, timezone: string) {
  const { year, month, day } = parseCivilDate(date)
  const target = Date.UTC(year, month - 1, day)
  let formatter = civilDateFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    civilDateFormatters.set(timezone, formatter)
  }
  const localDateNumber = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant))
    const get = (part: string) => Number(parts.find(({ type }) => type === part)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'))
  }
  let low = target - 48 * 60 * 60 * 1000
  let high = target + 48 * 60 * 60 * 1000
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (localDateNumber(middle) >= target) high = middle
    else low = middle + 1
  }
  return new Date(low).toISOString()
}

function parseCivilDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError('Некорректная дата')
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new RangeError('Некорректная дата')
  return { year, month, day }
}

function civilDate(year: number, month: number, day: number) { return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
function nextDay(year: number, month: number, day: number): [number, number, number] { const date = new Date(Date.UTC(year, month - 1, day + 1)); return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()] }
function addMonths(year: number, month: number, count: number) { const date = new Date(Date.UTC(year, month - 1 + count, 1)); return civilDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) }
