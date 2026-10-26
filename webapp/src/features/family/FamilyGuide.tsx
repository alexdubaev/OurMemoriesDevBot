/* eslint-disable typographyPolicy/use-typography-component -- tutorial prose uses semantic headings and details with scoped typography. */
import { useRef, useState, type CSSProperties } from 'react'
import type { AlbumDto, GiftDto, MemoryDto, MemoryReaction } from '@web-app-demo/contracts'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { BottomNavigation } from '@/components/BottomNavigation'
import { ChildHeader } from '@/components/ChildHeader'
import { useMemolyTheme } from '@/features/theme'
import { AlbumCatalogPresentation } from '@/features/albums/AlbumCatalogPresentation'
import { GiftPagePresentation } from '@/features/gifts/GiftPagePresentation'
import { GiftCardPresentation } from '@/features/gifts/GiftCard'
import '@/features/albums/albums.css'
import '@/features/gifts/gifts.css'
import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { FeedPresentation } from '@/features/feed/presentation/FeedPresentation'
import { MemoryCardPresentation } from '@/features/feed/presentation/MemoryCardPresentation'
import { MemoryActions, MemoryActionsContent, MemoryList, MixedMediaViewer, PhotoImage } from '@/features/feed/FeedPage'
import { AddSheetPanel, VoiceOrVideoPanel } from '@/features/memoly-ui/AddSheetPresentation'
import { createHostBridge } from '@/platform/host-bridge'
import type { AuthenticatedTransport } from '@/platform/api/authenticated-transport'
import beachPhoto from '../../../../assets/demo/beach.webp'
import './family-guide.css'

type Role = 'full' | 'viewer'
const noop = () => undefined
// Deliberately cannot access the authenticated transport or any real family's media.
const demoTransport: AuthenticatedTransport = {
  request: async () => { throw new Error('The introduction has no API connection') },
  raw: async () => { throw new Error('The introduction has no API connection') },
}
const demoMemory: MemoryDto = {
  id: '00000000-0000-4000-8000-000000000001', familyId: '00000000-0000-4000-8000-000000000002', childId: '00000000-0000-4000-8000-000000000003',
  author: { id: '00000000-0000-4000-8000-000000000004', name: 'Мама', avatarPath: null },
  kind: 'photo', body: 'Первый раз на море. Собрали ракушки и долго смотрели на волны.',
  occurredAt: '2026-07-12T12:00:00Z', firstPublishedAt: null, sourcePublishedAt: null, createdAt: '2026-07-12T12:00:00Z', version: 1, status: 'published',
  attachments: [{ id: '00000000-0000-4000-8000-000000000005', source: 'private_storage', kind: 'photo', width: 800, height: 600, durationMs: null, renditionStatus: 'ready', previewPath: null, displayPath: null, playbackPath: null, originalDownloadPath: '/api/media/demo-unavailable', waveform: null }],
  reactionCounts: {}, currentUserReaction: null, likes: { count: 0, likedByMe: false }, capabilities: { edit: false, delete: false, like: true },
}

const demoNote: MemoryDto = { ...demoMemory, id: '00000000-0000-4000-8000-000000000010', kind: 'note', attachments: [], author: { ...demoMemory.author, name: 'Папа' }, body: '«А море умеет спать? Оно всё время шевелится!»' }
const demoAlbum: AlbumDto = {
  id: '00000000-0000-4000-8000-000000000006', kind: 'free', templateVersion: 1, title: 'Наше лето', description: null,
  childId: demoMemory.childId, version: 1, cover: null, entryCount: 1, createdAt: demoMemory.createdAt, updatedAt: demoMemory.createdAt,
  capabilities: { edit: false, delete: false },
}
const demoGift: GiftDto = {
  id: '00000000-0000-4000-8000-000000000007', childId: demoMemory.childId, title: 'Семейная фотокнига', url: 'https://example.com/photo-book', price: null,
  photoMediaId: '00000000-0000-4000-8000-000000000008', createdBy: { userId: demoMemory.author.id, name: 'Мама' }, reservation: null,
  version: 1, createdAt: demoMemory.createdAt, updatedAt: demoMemory.createdAt,
}
const demoRelativeId = '00000000-0000-4000-8000-000000000009'

/** The production UI with synthetic data; only the tutorial controls have their own layout. */
export function FamilyGuide({ role, onClose, closeLabel = 'Вернуться к приглашению' }: {
  role: Role; onClose: () => void; closeLabel?: string
}) {
  const { theme } = useMemolyTheme()
  const [screen, setScreen] = useState<'feed' | 'albums' | 'gifts'>('feed')
  const [albumFilter, setAlbumFilter] = useState<'all' | 'template' | 'custom'>('all')
  const [gift, setGift] = useState(demoGift)
  const [step, setStep] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [reaction, setReaction] = useState<MemoryReaction | null>(null)
  const [noteReaction, setNoteReaction] = useState<MemoryReaction | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [sheet, setSheet] = useState<'help' | 'add' | 'voice' | 'memory' | null>(null)
  const [actionHint, setActionHint] = useState('')
  const [actionMemory, setActionMemory] = useState(demoMemory)
  const [reactionRequest, setReactionRequest] = useState({ memoryId: '', revision: 0 })
  const [hostBridge] = useState(() => createHostBridge())
  const insets = hostBridge.getInsets()
  const insetStyle = Object.fromEntries(Object.entries(insets).map(([side, value]) => [`--host-inset-${side}`, `${value}px`])) as CSSProperties
  const photoButton = useRef<HTMLButtonElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const sheetTrigger = useRef<HTMLElement | null>(null)
  const openSheet = (next: 'help' | 'add') => { sheetTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSheet(next) }
  const openActions = (memory: MemoryDto, trigger: HTMLButtonElement) => { sheetTrigger.current = trigger; setActionMemory(memory); setSheet('memory') }
  const steps = [
    { title: 'Ваша семейная лента', text: 'Здесь близкие сохраняют фото, видео, голос и истории. Это настоящий интерфейс memoLy с примерными материалами. Ничего из примера не попадёт в вашу семью.' },
    { title: 'Откройте фотографию', text: 'Нажмите фото в карточке: откроется обычный просмотрщик memoLy. Рассмотрите снимок и закройте его крестиком. Подсказку можно свернуть, чтобы она не мешала.' },
    { title: 'Откликнитесь близким', text: 'Откройте меню «⋯» → «Выбрать или изменить реакцию» или удерживайте свободную область карточки и выберите сердечко. Значок комментариев открывает общение о моменте; в примере мы покажем инструкцию.' },
    { title: 'Альбомы', text: 'Кнопка «Альбомы» в нижнем меню открывает подборки: например, отпуск или день рождения. Так важные истории легко находить спустя годы.' },
    { title: 'Вишлист', text: 'Кнопка «Вишлист» открывает пожелания. Родственник может забронировать подарок — другие увидят, что его уже выбрали. Бронь не покупает товар и не списывает деньги.' },
    { title: role === 'full' ? 'Добавьте свой момент' : 'Ваш доступ: просмотр', text: role === 'full' ? 'Нажмите «Добавить» в нижнем меню. Вы увидите настоящее меню выбора формата. Здесь можно познакомиться с ним; загрузка материалов начнётся уже в вашей семье.' : 'Можно смотреть, реагировать, комментировать и бронировать подарки. Для добавления воспоминаний попросите владельца семьи выдать полный доступ.' },
    { title: 'Готовы к семейному альбому', text: 'Закройте знакомство, проверьте название семьи в приглашении и нажмите «Присоединиться». Повторная инструкция доступна в разделе «Семья» → «Как пользоваться memoLy».' },
  ]
  const selectStep = (next: number) => { setScreen(next === 3 ? 'albums' : next === 4 ? 'gifts' : 'feed'); setStep(next); setCollapsed(false); setActionHint('') }
  const explainAction = (text: string) => { setSheet(null); setActionHint(text); setCollapsed(false) }
  return <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogPrimitive.Portal container={typeof document === 'undefined' ? undefined : document.querySelector<HTMLElement>('.memoly-app-root')}>
      <DialogPrimitive.Content aria-describedby={undefined} className="family-guide" style={insetStyle} onEscapeKeyDown={(event) => {
          // Vaul and radix-ui resolve separate dismissal stacks; dismiss only the inner layer.
          if (sheet !== null) { event.preventDefault(); setSheet(null) }
          else if (photoOpen) { event.preventDefault(); setPhotoOpen(false) }
        }} onCloseAutoFocus={(event) => event.preventDefault()}>
        <DialogPrimitive.Title className="sr-only">Пример семейного альбома</DialogPrimitive.Title>
        {screen === 'feed' ? <FeedPresentation activeFilter="all" childName="Аня" childSubtitle="3 года · Семья Соколовых" familyName="Семья Соколовых" insets={insets} role={role} addButtonRef={addButton}
          onAdd={() => openSheet('add')} onFeed={() => selectStep(0)} onAlbums={() => selectStep(3)} onGifts={() => selectStep(4)} onFamily={() => openSheet('help')} onFilterChange={noop}
          onOpenChild={() => explainAction('Нажмите имя ребёнка в своей семье, чтобы открыть его страницу и связанные воспоминания.')} onAllFamilies={() => explainAction('В «Моих семьях» можно выбрать другой семейный альбом.')} onOpenSettings={() => explainAction('В настройках можно изменить оформление и параметры приложения.')}>
          <MemoryList familyTimezone="Europe/Moscow" items={[demoMemory, demoNote]} renderCard={(memory) => memory.kind === 'photo' ? <MemoryCardPresentation actions={<MemoryActions memory={demoMemory} onOpen={openActions} />} reactionPickerRequest={reactionRequest.memoryId === demoMemory.id ? reactionRequest.revision : 0} authorInitials="М" authorName="Мама" body={demoMemory.body} kind="photo" memoryId={demoMemory.id} occurredTime="12 июля · 12:00"
            reactionCounts={reaction ? { [reaction]: 1 } : {}} currentUserReaction={reaction} onReaction={setReaction} onOpen={() => setPhotoOpen(true)} commentCount={0} onComments={() => { openSheet('help') }}
            media={<button aria-label="Открыть фото" className="ml-media-button block w-full" ref={photoButton} onClick={() => setPhotoOpen(true)} type="button"><PhotoImage alt="Воспоминание" width={800} height={600} src={beachPhoto} onLoad={noop} onError={noop} /></button>} />
          : <MemoryCardPresentation actions={<MemoryActions memory={demoNote} onOpen={openActions} />} reactionPickerRequest={reactionRequest.memoryId === demoNote.id ? reactionRequest.revision : 0} authorInitials="П" authorName="Папа" body="«А море умеет спать? Оно всё время шевелится!»" kind="note" memoryId={demoNote.id} occurredTime="12 июля · 18:00" media={null}
            reactionCounts={noteReaction ? { [noteReaction]: 1 } : {}} currentUserReaction={noteReaction} onReaction={setNoteReaction} onOpen={() => explainAction('В заметках сохраняются слова, мысли и семейные истории.')} commentCount={0} onComments={() => openSheet('help')} />} />
        </FeedPresentation> : screen === 'albums' ? <div className="albums-surface" data-albums-route="catalog">
          <ChildHeader childName="Аня" childSubtitle="3 года · Семья Соколовых" mode="feed" onAllFamilies={() => explainAction('В «Моих семьях» можно выбрать другой семейный альбом.')} theme={theme} />
          <main className="albums-main"><AlbumCatalogPresentation albums={albumFilter === 'template' ? [] : [demoAlbum]} filter={albumFilter} loading={false} role={role} onFilterChange={setAlbumFilter}
            onCreate={() => explainAction('В своей семье выберите шаблон альбома или создайте свою подборку и добавьте истории.')}
            onOpenAlbum={() => explainAction('В вашей семье здесь откроется альбом с историями и материалами. В знакомстве показан каталог; пример фотографии можно открыть в «Ленте».')}
            renderCover={() => <img alt="" src={beachPhoto} />} /></main>
          <BottomNavigation appearance="memoly" active="albums" role={role} onAdd={() => openSheet('add')} onAlbums={() => selectStep(3)} onGifts={() => selectStep(4)} onFeed={() => selectStep(0)} onFamily={() => openSheet('help')} />
        </div> : <GiftPagePresentation childName="Ани" role={role} showAddButton onCreate={() => explainAction('В своей семье укажите ссылку на товар, название и фото подарка.')} onAdd={() => openSheet('add')} onAlbums={() => selectStep(3)} onFeed={() => selectStep(0)} onFamily={() => openSheet('help')}>
          <ul className="gifts-list" data-slot="gifts-open-list"><li><GiftCardPresentation gift={gift} photo={{ url: beachPhoto, status: 'ready' }} variant="open" viewer={{ currentUserId: demoRelativeId, role, isOwner: false }} locked={false} pendingAction={null}
            onAction={(_, action) => {
              if (action === 'reserve') setGift({ ...gift, reservation: { userId: demoRelativeId, name: 'Вы', reservedAt: demoMemory.createdAt, boughtAt: null } })
              else if (action === 'cancel') setGift({ ...gift, reservation: null })
              explainAction(action === 'bought' ? 'В вашей семье эта кнопка перенесёт подарок в раздел «Подарено». Здесь покупка не отмечается.' : 'Это учебная бронь. Она не сохраняется и не оформляет покупку.')
            }} onDelete={() => explainAction('В своей семье удаление подарка потребует подтверждения.')} onEdit={() => explainAction('В своей семье здесь можно изменить название, фото и ссылку подарка.')} onOpenLink={() => explainAction('В вашей семье здесь откроется магазин. У учебного подарка нет настоящего товара.')} /></li></ul>
        </GiftPagePresentation>}
        <aside aria-label="Подсказки знакомства" className="family-guide-coach">
          <div className="family-guide-coach-heading"><span>Учебный пример · {step + 1}/{steps.length}</span><button aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} type="button">{collapsed ? 'Показать подсказку' : 'Свернуть подсказку'}</button></div>
          {!collapsed ? <><div aria-live="polite"><h2>{steps[step].title}</h2><p>{actionHint || steps[step].text}</p></div>
            <div className="family-guide-controls"><button disabled={step === 0} onClick={() => selectStep(step - 1)} type="button">Назад</button><button onClick={() => openSheet('help')} type="button">Инструкция</button>{step < steps.length - 1 ? <button onClick={() => selectStep(step + 1)} type="button">Далее</button> : null}</div></> : null}
          <button className="family-guide-exit" onClick={onClose} type="button">{closeLabel}</button>
        </aside>
        {photoOpen ? <MixedMediaViewer childName="Аня" familyTimezone="Europe/Moscow" hostBridge={hostBridge} index={0} initialPhotoUrl={beachPhoto} memory={demoMemory} onClose={() => setPhotoOpen(false)} onIndexChange={noop} returnFocusRef={photoButton} transport={demoTransport} preferReturnFocus /> : null}
        <MemolyBottomSheet open={sheet !== null} onOpenChange={(open) => { if (!open) setSheet(null) }} returnFocusRef={sheetTrigger}>
          {sheet === 'add' ? <AddSheetPanel onClose={() => setSheet(null)} onNote={() => explainAction('Заметка сохраняет текст: первые слова, смешную фразу или небольшую историю. В своей семье введите текст и подтвердите сохранение.')} onPhoto={() => explainAction('В своей семье выберите фото или видео с устройства, добавьте подпись и подтвердите загрузку.')} onVoiceOrVideo={() => setSheet('voice')} />
            : sheet === 'voice' ? <VoiceOrVideoPanel onBack={() => setSheet('add')} onClose={() => setSheet(null)} onOpenBot={() => explainAction('После вступления отправляйте голосовые боту MAX. Он поможет сохранить запись в нужную семью.')} onVideo={() => explainAction('В своей семье выберите готовый видеофайл с устройства и дождитесь окончания загрузки.')} />
            : sheet === 'memory' ? <MemoryActionsContent memory={actionMemory} onChooseReaction={() => { setSheet(null); setReactionRequest((current) => ({ memoryId: actionMemory.id, revision: current.revision + 1 })) }}
              onDetails={() => explainAction('В своей семье «Подробнее» откроет всю публикацию. Фотографию в примере можно рассмотреть, нажав на сам снимок.')}
              onEdit={role === 'full' ? () => explainAction('В своей семье здесь можно изменить подпись и дату воспоминания.') : undefined}
              onDelete={role === 'full' ? () => explainAction('В своей семье удаление воспоминания потребует подтверждения. Учебные материалы не удаляются.') : undefined} />
            : <div className="family-guide-help"><DrawerTitle>Как пользоваться memoLy</DrawerTitle><DrawerDescription>Пошаговая инструкция для родственников. Ваш доступ: {role === 'full' ? 'полный' : 'просмотр'}.</DrawerDescription><FamilyInstructions role={role} /><button className="family-guide-exit" onClick={() => setSheet(null)} type="button">Вернуться к примеру</button></div>}
        </MemolyBottomSheet>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

function FamilyInstructions({ role }: { role: Role }) {
  return <div className="family-guide-instructions">
    <details open><summary>1. Как присоединиться к близким</summary><ol>
      <li>Откройте ссылку, которую вам прислал родственник, и войдите через MAX.</li>
      <li>После знакомства вернитесь к приглашению. Проверьте название семьи и указанный доступ.</li>
      <li>Нажмите «Присоединиться» и дождитесь открытия семейного альбома. Создавать ещё одну семью или заполнять профиль ребёнка вам не нужно.</li>
    </ol><p>Уже вступили? Откройте свою семью в memoLy. Если семей несколько, выберите нужную в «Мои семьи».</p></details>
    <details><summary>2. Как смотреть фото, видео и слушать голос</summary><p>Откройте «Ленту» в нижнем меню. Нажмите на фотографию, чтобы рассмотреть её. Если у записи несколько фото, листайте их. У видео или голосового нажмите кнопку воспроизведения; звук не включается сам. Если ничего не слышно, проверьте громкость устройства.</p><p>В «Альбомах» собраны тематические подборки. Если лента пока пуста, попросите близких добавить первое воспоминание.</p></details>
    <details><summary>3. Сердечки и комментарии</summary><p>Откройте меню «⋯» → «Выбрать или изменить реакцию» или удерживайте свободную область карточки и выберите сердечко. С клавиатуры: выберите карточку и нажмите Shift+F10. Чтобы убрать реакцию, откройте выбор ещё раз и нажмите на отмеченную реакцию. Чтобы написать ответ, откройте комментарии под воспоминанием. Комментарии видны участникам семьи; свои ответы можно исправить или удалить.</p></details>
    <details><summary>4. Как выбрать подарок</summary><p>Откройте «Вишлист», выберите свободное пожелание и забронируйте его. Остальные участники увидят бронь и ваше имя. Если планы изменились, снимите свою бронь. После покупки можно отметить подарок как купленный.</p><p>Бронь не оформляет заказ и не списывает деньги. Ссылка на магазин открывается только по вашему действию.</p></details>
    {role === 'full' ? <details><summary>5. Как добавить воспоминание</summary><ol><li>В нижнем меню нажмите «Добавить».</li><li>Выберите фото и видео, заметку или «Голос или видео». Голосовые отправляются через бот MAX; в приложении можно выбрать готовый видеофайл. Укажите подпись и нужные отметки.</li><li>Подтвердите добавление и дождитесь завершения загрузки. Проверьте, что запись появилась в ленте.</li></ol><p>Можно также отправлять материалы боту MAX после подключения семьи. Если бот просит выбрать семью, следуйте его подсказке. Пока идёт обработка, не отправляйте одно и то же повторно.</p><p>Полный доступ разрешает менять и удалять воспоминания семьи. Перед удалением убедитесь, что запись действительно больше не нужна.</p></details>
      : <details><summary>5. Почему нет кнопки добавления</summary><p>Вам предоставлен доступ «Просмотр»: вы можете смотреть, реагировать, комментировать и бронировать подарки. Чтобы также добавлять воспоминания, попросите владельца семьи изменить ваш доступ. Вступать заново или создавать собственный альбом для этого не нужно.</p></details>}
    <details><summary>6. Если что-то не получилось</summary><p><strong>Ссылка устарела или отозвана:</strong> попросите пригласившего родственника прислать новую ссылку.</p><p><strong>Не удалось присоединиться:</strong> проверьте интернет и повторите. Если вы уже вступили, откройте «Мои семьи».</p><p><strong>Не открывается фото или видео:</strong> проверьте соединение и повторите загрузку. Если ошибка остаётся, сообщите владельцу семьи, на каком шаге она возникла.</p><p><strong>Загрузка ещё обрабатывается:</strong> дождитесь подтверждения и проверьте ленту перед повторной отправкой.</p></details>
    <details><summary>7. Кто видит семейные материалы</summary><p>Доступ к семейному альбому получают его участники в соответствии с выданной ролью. Не пересылайте приглашение посторонним. Участник с доступом может сохранить материал или сделать снимок экрана — поэтому важно приглашать тех, кому вы доверяете.</p><p>Учебные примеры не попадают в вашу семью. Закройте знакомство, чтобы вернуться к настоящему альбому.</p></details>
  </div>
}

export function FamilyGuideEntry({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <div className="family-guide-entry">
    <button className="family-guide-exit" ref={trigger} onClick={() => setOpen(true)} type="button">Как пользоваться memoLy</button>
    {open ? <FamilyGuide key={role} role={role} closeLabel="Закрыть знакомство" onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()) }} /> : null}
  </div>
}
