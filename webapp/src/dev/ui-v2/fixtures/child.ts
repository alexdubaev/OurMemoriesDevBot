// Stable demo date keeps catalog screenshots reproducible across hosts.
const demoToday = { year: 2026, month: 10, day: 2 }
export function childAge(birthDate?: string) {
  if (!birthDate) return 'Дата рождения не указана'
  const [year, month, day] = birthDate.split('-').map(Number)
  let years = demoToday.year - year
  if (demoToday.month < month || demoToday.month === month && demoToday.day < day) years--
  if (years < 1) return 'Меньше года'
  const tail = years % 100
  const unit = tail >= 11 && tail <= 14 ? 'лет' : years % 10 === 1 ? 'год' : years % 10 >= 2 && years % 10 <= 4 ? 'года' : 'лет'
  return `${years} ${unit}`
}
export function childBirthday(birthDate?: string) {
  if (!birthDate) return 'Не указан'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(birthDate + 'T00:00:00Z')).replace(/ г\.$/, '')
}
