export function familyCalendarDate(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: 'year' | 'month' | 'day') => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isBirthDateOnOrBeforeFamilyToday(
  birthDate: string,
  timezone: string,
  now = new Date(),
) {
  return isRealDateOnly(birthDate) && birthDate <= familyCalendarDate(timezone, now)
}

function isRealDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
