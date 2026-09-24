import type { FamilyResponse } from '@web-app-demo/contracts'

export type FamilySettingsChange = { name?: string; timezone?: string }

export function familySettingsChanges(family: FamilyResponse['family'], name: string, timezone: string): FamilySettingsChange | null {
  const changes: FamilySettingsChange = {}
  const trimmed = name.trim()
  if (trimmed !== family.name) changes.name = trimmed
  if (timezone !== family.timezone) changes.timezone = timezone
  return Object.keys(changes).length ? changes : null
}
