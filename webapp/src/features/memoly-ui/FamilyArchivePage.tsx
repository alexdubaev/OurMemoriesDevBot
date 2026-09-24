/* eslint-disable typographyPolicy/use-typography-component -- canonical archive page retains semantic text elements. */
import { WebpIcon } from '@/components/WebpIcon'
import { ManagementTopbar } from './FamilySettingsPage'
import './family-management.css'

export function FamilyArchivePage({ usage, usageFailed, onBack, onRefresh }: {
  usage: { usedBytes: number; quotaBytes: number | null } | null
  usageFailed: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const percent = usage?.quotaBytes ? Math.min(100, Math.round(usage.usedBytes / usage.quotaBytes * 100)) : null
  return <section aria-label="Семейный архив" className="family-management-page" data-slot="family-archive-page">
    <ManagementTopbar onBack={onBack} title="Семейный архив" />
    {usageFailed ? <div className="family-management-center" role="alert"><span className="family-management-center-icon"><WebpIcon decorative name="warning" size={34} /></span><h2>Не удалось загрузить объём архива</h2><p>Сами воспоминания доступны. Не удалось получить только информацию о занятом месте.</p><button className="family-management-primary" onClick={onRefresh} type="button">Повторить загрузку</button><button className="family-management-secondary" onClick={onBack} type="button">Назад</button></div> : usage ? <>
      <section className="family-management-card family-archive-card"><div className="family-archive-head"><span className="family-archive-icon"><WebpIcon decorative name="family" size={24} /></span><div><strong>Семейный архив</strong><small>Приватное хранилище семьи</small></div></div><div className="family-archive-number"><strong>{formatArchiveBytes(usage.usedBytes)}</strong><span>{usage.quotaBytes ? `из ${formatArchiveBytes(usage.quotaBytes)}` : 'Лимит не указан'}</span></div>{percent !== null ? <div aria-label="Использовано место в архиве" className="family-archive-progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div> : null}<p>Фото, голос и подготовленные медиа хранятся приватно и доступны только участникам семьи.</p></section>
      {percent !== null && usage.quotaBytes ? <section className="family-management-card family-archive-meta"><div><span>Свободно</span><strong>{formatArchiveBytes(Math.max(0, usage.quotaBytes - usage.usedBytes))}</strong></div><div><span>Использовано</span><strong>{percent}%</strong></div></section> : null}
    </> : <p aria-live="polite" className="family-management-status">Загружаем данные архива…</p>}
  </section>
}

function formatArchiveBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ГБ`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`
  return `${Math.round(value / 1024)} КБ`
}
