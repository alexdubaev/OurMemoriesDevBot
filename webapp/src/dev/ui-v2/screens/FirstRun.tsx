import { MemoLyLogo } from '../components/FamilyHero'
import { ErrorState, LoadingState, InlineNotice } from '../components/Feedback'
import { photos } from '../fixtures/data'
import { Button, Icon } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import { PageContent } from './common'
import type { ScreenProps } from './types'
export function FirstRun({ entry, actions }: ScreenProps) {
  const state = entry.state
  if (state === 'boot') return <div className="v2-first-run"><MemoLyLogo /><LoadingState label="Открываем ваш семейный альбом…" /></div>
  if (state === 'auth-error' || state === 'welcome-error' || state === 'max-approval-error') return <PageContent><MemoLyLogo /><ErrorState title={state === 'max-approval-error' ? 'Не удалось подтвердить вход' : 'Не удалось открыть альбом'} body="Проверьте соединение. Ваши воспоминания сохранены." onRetry={() => actions.go('first-run:welcome-continue')} /></PageContent>
  if (state.startsWith('welcome') || state === 'max-context') return <div className="v2-welcome">
    <MemoLyLogo /><div className="v2-welcome-photo"><img src={photos.family} alt="Синтетическая семья на прогулке" /><Typography as="span" className="v2-photo-label" variant="caption">Обычный день. Навсегда ваш.</Typography></div>
    <div className="v2-welcome-copy"><Typography as="h1" variant="display">Маленькие моменты.<br />Большая история.</Typography><Typography>Фото, голос и слова, которые хочется беречь. В семейном альбоме, куда вы приглашаете только близких.</Typography><div className="v2-privacy-line"><Icon name="lock" size={20} /><Typography as="span" variant="meta">Ваше семейное пространство</Typography></div>
      {state === 'welcome-intro' ? <Button tone="quiet" onPress={() => actions.go('first-run:welcome-continue')}>Пропустить вступление</Button> : <Button onPress={() => actions.go('families:multiple')}>Продолжить</Button>}
      {state === 'max-context' && <InlineNotice>Вы открыли memoLy в MAX. Сохраняйте моменты здесь или отправляйте их нашему боту.</InlineNotice>}
    </div>
  </div>
  const approved = state === 'login-approved' || state === 'max-approved'
  const approval = state.startsWith('max-approval')
  const pending = ['login-pending', 'login-redeeming', 'max-approval-busy', 'login-starting'].includes(state)
  const failed = state === 'login-error' || state === 'login-expired'
  return <PageContent><MemoLyLogo /><section className="v2-auth">
    <div className="v2-state-mark"><Icon name={approved ? 'check' : 'lock'} size={32} /></div>
    <Typography as="h1" variant="title">{approved ? 'Вход подтверждён' : state === 'open-telegram' ? 'Откройте memoLy в Telegram' : approval ? 'Это вы входите?' : 'Ваш альбом — рядом'}</Typography>
    <Typography>{approved ? 'Теперь можно вернуться к вашим семейным воспоминаниям.' : approval ? 'Подтвердите вход, только если вы сами открыли memoLy в браузере и коды совпадают.' : state === 'open-telegram' ? 'Откройте нашего бота и продолжите в приложении.' : 'Для входа в браузере подтвердите, что это вы, в приложении MAX.'}</Typography>
    {!approved && !failed && state !== 'open-telegram' && <><Typography as="span" variant="meta">Код подтверждения</Typography><Typography className="v2-login-code" variant="title">Л И Л И Я 7</Typography></>}
    {failed && <InlineNotice error>{state === 'login-expired' ? 'Время действия кода истекло. Создайте новый код.' : 'Не удалось завершить вход. Попробуйте снова.'}</InlineNotice>}
    {pending && <LoadingState label={state === 'login-redeeming' ? 'Завершаем вход…' : state === 'login-starting' ? 'Создаём код…' : 'Ожидаем подтверждение…'} />}
    <Button onPress={() => actions.go(approved || state === 'open-telegram' ? 'families:multiple' : approval ? 'first-run:max-approved' : state === 'browser-login' || failed ? 'first-run:login-pending' : 'first-run:login-approved')}>{approved ? 'Открыть мои семьи' : state === 'open-telegram' ? 'Открыть бота' : approval ? 'Подтвердить вход' : failed ? 'Создать новый код' : state === 'browser-login' ? 'Войти через MAX' : 'Открыть MAX'}</Button>
  </section></PageContent>
}
