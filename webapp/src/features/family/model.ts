type CalendarDate = { year: number; month: number; day: number }

export function ageFromBirthDate(birthDate: string, now = new Date()) {
  const birth = parseDateOnly(birthDate)
  if (!birth) return null
  const months = completedMonths(birth, dateParts(now, 'UTC'))
  return months < 0 ? null : Math.floor(months / 12)
}

export function formatChildAge(birthDate: string, timezone: string, now = new Date()) {
  const birth = parseDateOnly(birthDate)
  if (!birth) return null
  const today = dateParts(now, timezone)
  const months = completedMonths(birth, today)
  if (months < 0) return null
  if (months === 0) {
    const days = Math.max(0, Math.floor((Date.UTC(today.year, today.month - 1, today.day) - Date.UTC(birth.year, birth.month - 1, birth.day)) / 86_400_000))
    return `${days} ${plural(days, 'день', 'дня', 'дней')}`
  }
  if (months < 12) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest === 0 ? `${years} ${plural(years, 'год', 'года', 'лет')}` : `${years} ${plural(years, 'год', 'года', 'лет')} ${rest} ${plural(rest, 'месяц', 'месяца', 'месяцев')}`
}

function parseDateOnly(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? { year, month, day } : null
}

function dateParts(now: Date, timezone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const pick = (type: 'year' | 'month' | 'day') => Number(parts.find((part) => part.type === type)?.value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

function completedMonths(birth: CalendarDate, today: CalendarDate) {
  let months = (today.year - birth.year) * 12 + today.month - birth.month
  if (today.day < birth.day) months -= 1
  return months
}

function plural(value: number, one: string, few: string, many: string) {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 14) return many
  if (value % 10 === 1) return one
  if (value % 10 >= 2 && value % 10 <= 4) return few
  return many
}

export function roleLabel(role: 'full' | 'viewer', isOwner: boolean) {
  if (isOwner) return 'Владелец'
  return role === 'full' ? 'Полный доступ' : 'Просмотр'
}

export function familyMemberName(member: { displayName: string | null; familyDisplayName: string | null }) {
  return member.familyDisplayName ?? member.displayName ?? 'Участник семьи'
}
