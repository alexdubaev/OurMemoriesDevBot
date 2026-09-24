/* eslint-disable typographyPolicy/use-typography-component -- canonical family settings retains semantic text elements. */
import type { FamilyResponse } from '@web-app-demo/contracts'
import { useRef, useState } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { familySettingsChanges, type FamilySettingsChange } from './family-settings-model'
import './family-management.css'

export function FamilySettingsPage({ family, busy, onBack, onRefresh, onSave }: {
  family: FamilyResponse['family']
  busy: boolean
  onBack: () => void
  onRefresh: () => void
  onSave: (input: FamilySettingsChange) => Promise<void>
}) {
  const [name, setName] = useState(family.name)
  const [timezone, setTimezone] = useState(family.timezone)
  const [error, setError] = useState(false)
  const [saved, setSaved] = useState(false)
  const pending = useRef(false)
  const changes = familySettingsChanges(family, name, timezone)
  const timezones = Array.from(new Set([family.timezone, 'Europe/Riga', 'Europe/Amsterdam', 'Europe/Moscow', 'UTC']))

  async function save() {
    if (busy || pending.current || !changes || name.trim().length < 1 || name.trim().length > 80) return
    pending.current = true
    setError(false)
    try { await onSave(changes); setSaved(true) }
    catch { setError(true); setSaved(false) }
    finally { pending.current = false }
  }

  return <section aria-label="Настройки семьи" className="family-management-page" data-slot="family-settings-page">
    <ManagementTopbar onBack={onBack} title="Настройки семьи" />
    <form className="family-management-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <section className="family-management-card family-management-fields">
        <label htmlFor="family-settings-name">Название семьи</label>
        <input autoComplete="off" id="family-settings-name" maxLength={80} onChange={(event) => { setName(event.target.value); setSaved(false) }} required value={name} />
        <label htmlFor="family-settings-timezone">Часовой пояс</label>
        <select id="family-settings-timezone" onChange={(event) => { setTimezone(event.target.value); setSaved(false) }} value={timezone}>{timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>
        <p>Часовой пояс используется для дат, возраста ребёнка и группировки ленты по дням.</p>
      </section>
      {error ? <div className="family-management-error" role="alert">Не удалось сохранить настройки семьи. Обновите данные и попробуйте снова.<button onClick={onRefresh} type="button">Обновить данные</button></div> : null}
      {saved ? <p aria-live="polite" className="family-management-success">Настройки семьи сохранены</p> : null}
      <button className="family-management-primary" disabled={!changes || busy || name.trim().length === 0} type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      {busy ? <p aria-live="polite" className="family-management-status">Сохраняем настройки семьи</p> : null}
    </form>
  </section>
}

export function ManagementTopbar({ onBack, title }: { onBack: () => void; title: string }) {
  return <div className="family-management-topbar"><button aria-label="Назад" className="family-round-btn family-back-btn" onClick={onBack} type="button"><WebpIcon decorative name="chevron" size={22} /></button><h1>{title}</h1><span /></div>
}
