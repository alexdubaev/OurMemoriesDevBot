import { composerOccurredAt } from '@/features/composer'

export function reservationOccurredAt(selectedDate: string, familyTimezone: string, now = new Date()) {
  return composerOccurredAt(selectedDate, familyTimezone, now)
}
