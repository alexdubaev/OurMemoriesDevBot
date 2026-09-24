/* eslint-disable typographyPolicy/use-typography-component -- frozen child profile preserves the approved semantic hierarchy. */
import type { FamilyResponse } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import { ChildAvatar } from './ChildAvatar'
import { familyCalendarDate, formatChildAge } from './model'

type Child = NonNullable<FamilyResponse['child']>

export function ChildProfile({ avatarUrl, canEdit, child, familyTimezone, onBack, onEdit, onChangePhoto, onOpenAge, showAgeDetails }: {
  avatarUrl: string | null
  canEdit: boolean
  child: Child
  familyTimezone: string
  onBack: () => void
  onEdit: () => void
  onChangePhoto: () => void
  onOpenAge: () => void
  showAgeDetails: boolean
}) {
  const age = child.birthDate ? formatChildAge(child.birthDate, familyTimezone) : null
  const birthDate = child.birthDate ? formatBirthDate(child.birthDate) : null
  const details = child.birthDate ? ageDetails(child.birthDate, familyTimezone) : null
  const backLabel = showAgeDetails ? 'Назад к профилю ребёнка' : 'Назад к семье'

  return <section aria-label={showAgeDetails ? 'Возраст ребёнка' : 'Профиль ребёнка'} className="child-profile" data-slot="child-profile">
    <div className="child-titlebar">
      <button aria-label={backLabel} className="family-round-btn child-back-btn" onClick={onBack} type="button"><WebpIcon className="family-back-icon" decorative name="chevron" size={22} /></button>
      <div className="child-page-title">{showAgeDetails ? 'Возраст' : 'Профиль ребёнка'}</div>
      <div className="child-title-action">{showAgeDetails ? null : <WebpIcon decorative name="more" size={28} />}</div>
    </div>
    <div className={`child-hero${showAgeDetails ? ' compact' : ''}`}>
      <div className="child-avatar-wrap"><ChildAvatar avatarCrop={child.avatarCrop} avatarUrl={avatarUrl} name={child.name} size="profile" /><span aria-hidden="true" className="child-avatar-glow" /></div>
      <h2>{child.name}</h2>
      {age ? <div className="child-age">{age}</div> : null}
      {birthDate ? <div className="child-born">{child.sex === 'boy' ? 'Родился' : child.sex === 'girl' ? 'Родилась' : 'Дата рождения:'} {birthDate}</div> : <div className="child-born">Дата рождения не указана</div>}
    </div>
    {showAgeDetails ? <>
      {details ? <div className="child-age-card">
        <div><span>Возраст</span><strong>{age}</strong></div>
        <div><span>Полных месяцев</span><strong>{details.months} {countWord(details.months, 'месяц', 'месяца', 'месяцев')}</strong></div>
        <div><span>Дней с рождения</span><strong>{details.days} {countWord(details.days, 'день', 'дня', 'дней')}</strong></div>
      </div> : null}
      <div className="child-helper centered">Возраст обновляется автоматически на основе даты рождения.</div>
      {canEdit ? <button className="child-secondary" onClick={onEdit} type="button">Изменить данные</button> : null}
    </> : <>
      <div className="child-quote">«Наше маленькое<br />большое счастье» <span>☀️</span></div>
      {canEdit || birthDate ? <div className="child-action-list">
        {canEdit ? <>
          <ActionRow icon="edit" label="Редактировать профиль" onClick={onEdit} />
          <ActionRow icon="photo" label="Сменить фото" onClick={onChangePhoto} />
        </> : null}
        {birthDate ? <ActionRow icon="clock" label="Возраст и дата рождения" onClick={onOpenAge} /> : null}
      </div> : null}
      <div className="child-info-note"><span aria-hidden="true" className="child-info-mark">●</span><span>Профиль ребёнка видят участники семьи. Здесь хранится только информация, нужная для семейного архива.</span></div>
    </>}
  </section>
}

function ActionRow({ icon, label, onClick }: { icon: 'edit' | 'photo' | 'clock'; label: string; onClick: () => void }) {
  return <button className="child-action-row" onClick={onClick} type="button"><WebpIcon decorative name={icon} size={21} /><span>{label}</span><WebpIcon className="child-action-chevron" decorative name="chevron" size={17} /></button>
}

function formatBirthDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).formatToParts(date)
  const part = (type: 'day' | 'month' | 'year') => parts.find((item) => item.type === type)?.value
  return `${part('day')} ${part('month')} ${part('year')}`
}

function ageDetails(birthDate: string, timezone: string) {
  const today = familyCalendarDate(timezone)
  const [year, month, day] = today.split('-').map(Number)
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number)
  if (![year, month, day, birthYear, birthMonth, birthDay].every(Number.isInteger)) return null
  const days = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(birthYear, birthMonth - 1, birthDay)) / 86_400_000)
  if (days < 0) return null
  const months = (year - birthYear) * 12 + month - birthMonth - (day < birthDay ? 1 : 0)
  return { days, months }
}

function countWord(value: number, one: string, few: string, many: string) {
  const lastTwo = value % 100
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = value % 10
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many
}
