/* eslint-disable typographyPolicy/use-typography-component -- canonical leave state retains semantic text elements. */
import { useRef, useState } from 'react'

import { WebpIcon } from '@/components/WebpIcon'
import { ManagementTopbar } from './FamilySettingsPage'
import './family-management.css'

export function FamilyLeavePage({ busy, onBack, onLeave }: { busy: boolean; onBack: () => void; onLeave: () => Promise<void> }) {
  const [error, setError] = useState(false)
  const pending = useRef(false)
  async function leave() {
    if (busy || pending.current) return
    pending.current = true
    try { await onLeave() }
    catch { setError(true) }
    finally { pending.current = false }
  }
  return <section aria-label="Выход из семьи" className="family-management-page" data-slot="family-leave-page"><ManagementTopbar onBack={onBack} title="Семья" /><div className="family-management-center"><span className="family-management-center-icon"><WebpIcon decorative name="warning" size={34} /></span><h2>{error ? 'Не удалось выйти из семьи' : 'Выйти из семьи?'}</h2><p>{error ? 'Ничего не изменилось. Проверьте соединение и повторите попытку.' : 'Вы потеряете доступ к приватным воспоминаниям этой семьи.'}</p>{!error ? <div className="family-management-note">Владелец семьи выйти не может. Этот сценарий доступен только другим участникам.</div> : null}<button className={error ? 'family-management-primary' : 'family-management-danger'} disabled={busy} onClick={() => void leave()} type="button">{busy ? 'Выходим…' : error ? 'Повторить' : 'Выйти из семьи'}</button><button className="family-management-secondary" disabled={busy} onClick={onBack} type="button">Отмена</button></div></section>
}
