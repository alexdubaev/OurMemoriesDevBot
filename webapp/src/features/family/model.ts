type CalendarDate = { year: number; month: number; day: number }

export const onboardingSaveErrorMessage = 'Не удалось сохранить данные. Попробуйте ещё раз.'

export function familyCalendarDate(timezone: string, now = new Date()) {
  const today = dateParts(now, timezone)
  return [today.year, pad(today.month), pad(today.day)].join('-')
}

export function isBirthDateOnOrBeforeFamilyToday(birthDate: string, timezone: string, now = new Date()) {
  return parseDateOnly(birthDate) !== null && birthDate <= familyCalendarDate(timezone, now)
}

export function inviteIssueMessage(code: string) {
  const copy: Record<string, string> = {
    OTHER_FAMILY: 'У вас уже есть другая активная семья. Сначала завершите работу с ней; текущее приглашение не использовано.',
    ALREADY_IN_FAMILY: 'Вы уже состоите в другой семье.',
    INVITE_EXPIRED: 'Срок действия приглашения истёк.',
    INVITE_REVOKED: 'Это приглашение отозвано.',
    INVITE_USED: 'Это приглашение уже использовано.',
    NOT_FOUND: 'Приглашение не найдено.',
    NETWORK: 'Не удалось проверить приглашение. Проверьте соединение.',
  }
  return copy[code] ?? 'Не удалось обработать приглашение. Попробуйте ещё раз.'
}

export function inviteIssueCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code
  }
  return error instanceof TypeError ? 'NETWORK' : 'UNKNOWN'
}

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

export function feedChildSubtitle(birthDate: string | null | undefined, timezone: string, now = new Date()) {
  return birthDate ? formatChildAge(birthDate, timezone, now) ?? 'Профиль ребёнка' : 'Профиль ребёнка'
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

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function roleLabel(role: 'full' | 'viewer', isOwner: boolean) {
  if (isOwner) return 'Владелец'
  return role === 'full' ? 'Полный доступ' : 'Просмотр'
}

export function familyMemberName(member: { displayName: string | null; familyDisplayName: string | null }) {
  return member.familyDisplayName ?? member.displayName ?? 'Участник семьи'
}
