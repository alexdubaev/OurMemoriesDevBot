import { familyCalendarDate } from '@/features/family'
import type { MemoryDto } from '@web-app-demo/contracts'

/** Convert the date-only composer value to the existing occurredAt contract. */
export function composerOccurredAt(selectedDate: string, familyTimezone: string, now = new Date()) {
  const today = familyCalendarDate(familyTimezone, now)
  if (!isDateOnly(selectedDate) || selectedDate > today) return null
  if (selectedDate === today) return now.toISOString()

  const pastDate = utcInstantForFamilyNoon(selectedDate, familyTimezone)
  return pastDate && composerDateOnly(pastDate.toISOString(), familyTimezone) === selectedDate ? pastDate.toISOString() : null
}

/** Read a stored instant as the date shown by a composer in the family's timezone. */
export function composerDateOnly(value: string, familyTimezone: string) {
  const instant = new Date(value)
  if (Number.isNaN(instant.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: familyTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : ''
}

export function composerInitialDate(familyTimezone: string) {
  return familyCalendarDate(familyTimezone)
}

export function memoryComposerInitialDate(memory: MemoryDto, familyTimezone: string) {
  return composerDateOnly(memory.occurredAt, familyTimezone) || familyCalendarDate(familyTimezone)
}

/**
 * Compatibility wrapper retained for the existing Photo Composer contract.
 * New composers should use composerOccurredAt, which resolves local family noon.
 */
export function photoOccurredAt(selectedDate: string, familyTimezone: string, now = new Date()) {
  const today = familyCalendarDate(familyTimezone, now)
  if (!isDateOnly(selectedDate) || selectedDate > today) return null
  if (selectedDate === today) return now.toISOString()
  const pastDate = new Date(`${selectedDate}T12:00:00.000Z`)
  return Number.isNaN(pastDate.getTime()) ? null : pastDate.toISOString()
}

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function utcInstantForFamilyNoon(selectedDate: string, familyTimezone: string) {
  let instant = new Date(`${selectedDate}T12:00:00.000Z`)
  if (Number.isNaN(instant.getTime())) return null
  const [targetYear, targetMonth, targetDay] = selectedDate.split('-').map(Number)
  const targetLocalAsUtc = Date.UTC(targetYear!, targetMonth! - 1, targetDay!, 12)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: familyTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(instant)
    const year = Number(parts.find((part) => part.type === 'year')?.value)
    const month = Number(parts.find((part) => part.type === 'month')?.value)
    const day = Number(parts.find((part) => part.type === 'day')?.value)
    const hour = Number(parts.find((part) => part.type === 'hour')?.value)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value)
    const second = Number(parts.find((part) => part.type === 'second')?.value)
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, instant.getUTCMilliseconds())
    const offsetMs = localAsUtc - instant.getTime()
    const next = new Date(targetLocalAsUtc - offsetMs)
    if (next.getTime() === instant.getTime()) return instant
    instant = next
  }
  return instant
}
