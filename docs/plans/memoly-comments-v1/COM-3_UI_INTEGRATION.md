# COM-3 — комментарии в интерфейсе memoLy v4

**Цель:** пользователь открывает обсуждение из любой карточки, читает, отправляет, исправляет и удаляет сообщения через готовый API COM-1/2.
**Архитектура:** одна панель и небольшой feature comments; клиентские запросы через действующий AuthenticatedTransport/TanStack Query; existing UI primitives/avatars. FeedPage только подключает feature, не содержит всю новую логику.
**Стек:** имеющийся React/Vite/TypeScript, действующие зависимости. Никакого react-comments-section/fork/нового редактора.
**Спецификация:** `00_START_HERE.md` + `01_COMMON_REQUIREMENTS.md`.
**Зависимости:** backend COM-1/2 и принятый v4 в разрешённой базе. Нельзя сливать #185 ради выполнения этого пункта.

## Файлы и интерфейс

Создать в `webapp/src/features/comments/`:
- `api.ts`: list/create/update/delete/summaries через действующий транспорт;
- `queries.ts`: scoped keys, запросы, invalidation, ограниченный lifecycle;
- `CommentsPanel.tsx`: единственная управляемая панель;
- `CommentItem.tsx`, `CommentComposer.tsx`, `comments.css`, `index.ts`;
- при необходимости небольшой pure helper для нормализации/merge страниц/статуса отправки, не отдельный state framework.

Минимально изменить:
- `webapp/src/features/feed/FeedPage.tsx` — выбранная Memory, scope, batch summaries, открытие панели;
- `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx` — callback и кнопка, не переписывать long-press;
- `webapp/src/features/feed/presentation/memoly-feed.css` — только компактное размещение кнопки;
- существующий session/private-cache cleanup hook, если новый namespace иначе не очищается, без смены auth architecture.

Переиспользовать настоящий AvatarPhoto/MemberAvatarImage/private loader и принятые диалоги. Не менять `shared-author-avatars` только ради переноса; при необходимой минимальной интеграции сохранить crop, reuse и очистку URL.

Создать tests:
`webapp/tests/comments-state.test.ts`, `webapp/tests/comments-scope.test.tsx`, `webapp/e2e/comments.spec.ts`, `webapp/e2e/comments.playwright.config.ts` и минимальный синтетический harness по существующему образцу, если нужен.

Предлагаемый interface панели:
`CommentsPanel({open, memoryId, familyId, accountId, membershipEpoch, familyTimezone, hostBridge, transport, onClose, returnFocusRef})`.
Точные общие типы брать из COM-1/2; не копировать DTO руками. Существующие insets передавать штатным способом. Новый callback карточки не должен подменять открытие фото или деталей.

## Пользовательское поведение

В ленте «Комментарии» при нуле/ещё не загруженном count, «Комментарии · N» при положительном count. Ошибка счётчика не делает недостоверный ноль. Кнопка не увеличивает медиарамку, не возвращает внешние карточки и не сдвигает нижнее меню.

Панель: заголовок, отдельная доступная кнопка закрытия, список в хронологическом порядке, «Показать более ранние», поле снизу. В начальном пустом состоянии «Пока нет комментариев. Напишите первым». Отдельные loading/error/retry состояния, не пустой список при ошибке.

Поле: multiline plaintext, обычная клавиатура и системные emoji. Placeholder «Написать комментарий…». Отправка только явной кнопкой; Enter добавляет перевод строки, не отправляет неожиданно. IME composition не запускает submit. Минимальный размер шрифта input 16px, touch controls минимум 44px. Не вводить новый emoji picker.

В строке: личный аватар/crop, семейное имя, время, текст, «изменено» после правки. Контролы edit/delete по серверным capabilities. Owner не получает кнопки редактирования чужого текста. Confirm delete с доступной отменой.

Успешный POST отображается по подтверждённому сервером DTO. Ошибка сохраняет текст, network timeout сохраняет ключ попытки и предлагает безопасный повтор. Не очищать поле при старте запроса. PATCH conflict сохраняет введённый текст и показывает, что комментарий уже изменён. После delete обновляется список и summary без полного сброса ленты.

На открыть/focus/свои операции/ручное обновление — актуализация. Фонового polling, real-time и уведомлений нет. Старые страницы подгружаются сверху с сохранением позиции чтения. После собственной отправки показать сообщение без скачка позиции всей ленты.

## Порядок

- [ ] Проверить подходящий baseline и реальные endpoints; если нет принятого v4, один blocker вместо самостоятельного merge/копирования UI.
- [ ] Написать tests для нормализации, состояния pending/error/retry, scoped keys и отбрасывания позднего ответа. Подключать заглушки только в тестах, не в production пути.
- [ ] Реализовать api/queries без прямого fetch в обход транспорта. Тексты не сохранять в localStorage/IndexedDB/SW; cleanup/logout должен реально удалять новые queries.
- [ ] Собрать панель из имеющихся primitives. CSS ограничить feature-контейнером. Взять реальные API-данные для интегрированного пути.
- [ ] Добавить компактную кнопку в карточку и пакетные summaries. Не делать запрос/таймер/панель на каждую запись. Старые strict MemoryDto не менять.
- [ ] Пройти успешные и ошибочные browser-сценарии, safe areas, клавиатуру/историю/жесты; сравнить screenshots до/после на синтетических данных.
- [ ] Выполнить risk gate/review по AGENTS; handoff с готовой UI-функцией и отдельно непроверенными физическими сценариями. Production в COM-3 не менять.

## Обязательные browser и state tests

- Все типы Memory, старый MAX-импорт и ручной пост: правильная связь обсуждения и автор-человек.
- 320/390/430px, длинные имена, 2000 символов/переносы/emoji, шесть действующих тем без новой темы. No horizontal overflow; кнопки доступны.
- Double click/pending/timeout/retry: один реальный request key, один comment, черновик не потерян, нет ложного success.
- Edit/delete/cancel/version conflict и разные права; родительская Memory недоступна во время открытой панели — закрытие/очистка, не пустой успешный экран.
- Смена family/account/epoch, logout/revoke при pending list/mutation: поздний ответ A не попадает в B. Проверить не только DOM, но и query cache/draft state.
- После закрытия нет активного polling, фоновых списков и растущего Map черновиков/таймеров. Смена 60 постов не создаёт 60 editor instances.
- 50 карточек дают batch summaries, не 50 отдельных count-запросов; сам список не загружается до открытия. Повторное открытие не дублирует сообщения.
- MAX Back, UI close, Esc, overlay и подтверждение непустого черновика возвращают к прежней позиции/вложению, без двойного history.back и выхода из приложения. При forced logout подтверждение не блокирует закрытие.
- Long-press карточки продолжает открывать реакции; кнопка комментариев, поле и выделение в поле не запускают реакцию/открытие медиа. Не ослаблять прежний запрет выделения на поверхности ленты.
- Play/pause/seek, карусель, fullscreen, стабильная рамка и освобождение video source/objectURL не меняются. Открытие модального обсуждения использует существующий способ остановить фоновое видео, если он предусмотрен, без нового playback coordinator.
- При старом API без endpoints comments-функция локально недоступна, но лента работает. 401 обслуживает существующая auth recovery; 403/404 открытого обсуждения закрывают доступ к этой цели, не выключают функцию глобально. По одному 404 нельзя утверждать «старый backend». Если штатного однозначного capability-сигнала нет, показывать нейтральную ошибку комментариев с retry, сохраняя ленту, а не добавлять ради определения версии новый auth/probe механизм.

## Проверки

```sh
bun test webapp/tests/comments-state.test.ts webapp/tests/comments-scope.test.tsx
(cd webapp && bun run typecheck)
(cd webapp && bun run lint)
bunx playwright test -c webapp/e2e/comments.playwright.config.ts
git diff --check
```

Существующие targeted media/longpress regressions запускать по затронутой границе. Профиль выбирает действующий classifier, не считать session/cache изменения косметикой. WebKit/CDP эмуляция не равна настоящему iPhone/MAX и экранной клавиатуре; отметить ограничение, не выдумывать физическую приёмку.

## Готовность

В локальном приложении через реальный API проходит весь сценарий; mock harness не выдаётся за end-to-end. Синтетические screenshots и exit codes сохранены; перечень действий владельцу на iPhone короткий. Никаких изменений нижнего меню/медиадвижков сверх необходимого. Передать COM-4 фактические SHA API/frontend/schema, endpoint support behavior, тесты и найденные ограничения.
