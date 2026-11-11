# IMPLEMENTATION — перенос v4 без переписывания продукта

Task: `MEMOLY-UI-V4-PIXEL-IMPLEMENTATION`.
Spec: [SPEC.md](SPEC.md). Acceptance: [ACCEPTANCE.md](ACCEPTANCE.md).

## 0. Назначение и полномочия

Это план реализации UI для следующего агента. Текущая ветка `docs/memoly-ui-v4-pixel-spec` публикует только визуальный пакет, не production-код. Не сливать этот reference PR автоматически. Для реализации создать один новый isolated worktree и feature branch от свежего принятого main; пакет эталона брать по закреплённому commit из отдельной docs-ветки. Сохранить его SHA256 и reference commit в отчёте.

Результат исполнителя — один проверенный implementation PR и полный визуальный отчёт. **Merge и production deploy нового UI требуют приёмки владельцем; это задание не активирует прежнее default-deploy разрешение для непоказанного UI.** Обычные изменения, проверки и создание draft PR выполняются автономно, без остановки на каждый блок.

Сначала проверить Git/origin/worktree, действующий AGENTS/teamlead, опубликованные последние исправления. Известный на момент подготовки main `f0a4e8ba3fa174f43c661ab2a70a6b744c6543f4` — ориентир, не вечный pin. Нельзя основывать новый UI на старом `3fce...` или повторно внедрять завершённые PR #176–#183.

Если reference PR ещё не слит, извлечь только его docs-папку в отдельный временный каталог из закреплённого ref. Не переносить всю историю docs-ветки в product branch и не подменять свежий main ею.

## 1. Точная карта исходников

Ниже пути, существование/назначение ключевых presentation-путей сверены на f0a4e8b. Перед редактированием подтвердить реальный import/render path. Особенно важно: имя похожего старого компонента не означает, что он используется.

| Граница | Основная поверхность | Действие |
|---|---|---|
| Theme/typography | `webapp/src/components/typography`, `webapp/src/features/theme`, существующие style tokens | Добавить/актуализировать семантические размеры и цветовые roles v4 внутри действующей системы; никаких внешних font/CDN |
| Header | `webapp/src/components/ChildHeader.tsx`, `ChildHeader.css`; возможный активный `components/ui-v2/ChildHeaderV2` | Проверить readUiVersion и активный renderer. Применить96px, фон, отсутствие logo/slogan, существующие callbacks/crop |
| Bottom bar | `webapp/src/components/BottomNavigation` и активный v2 presentation | Сохранить handlers/role restrictions; заменить только размеры/оболочку |
| Feed shell | `webapp/src/features/feed/presentation/FeedPresentation.tsx`, `memoly-feed.css` | Реальный header/feed-rest/unread/scroll-owner, insets, gaps |
| Card | `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx` | Только presentation slots/spacing/type. Сохранить long-press, pointer guards, refs, context и handlers |
| Reactions | `webapp/src/features/feed/presentation/MemoryReactions`, связанные styles | Только оформление; не подменять реальную реакцию boolean-лайком |
| Note | `webapp/src/features/feed/presentation/NoteStoryPresentation` | Оформление текстовой заметки; сохранить selection/handlers |
| Media composition | `webapp/src/features/feed/FeedPage.tsx` | Узкий presentation diff рамки/controls и чистый ratio helper; не рефакторить большой файл целиком |
| Family | `webapp/src/features/memoly-ui/FamilyPresentation.tsx`, `family-management.css`, `member-profile.css`, существующие profile/settings/invites presentations | Общий список участников, один invite, канал ниже, сохранённые actions/permissions |
| Family controllers | `webapp/src/features/family/FamilyScreen.tsx` | По возможности не менять; только wiring прежних props в обновлённую оболочку, без мутаций/refresh семантики |
| Composer/settings/sheets | `AddSheetPresentation.tsx`, `SettingsSheet.tsx`, `FamilySettingsPage.tsx`, `FamilyInvitesPage.tsx`, `MemberProfile.tsx`, `MemolyBottomSheet`, действующие composers | Применить primitives SPEC; не заменить настоящие формы заглушками |
| Acceptance | существующие `webapp/e2e` и `webapp/tests` | Добавить узкие layout/visual/ratio regression, переиспользовать media/family fixtures |

`webapp/src/features/memoly-ui/FeedPresentation.tsx` существует, но не является доказательством активного пути ленты. Главный import в текущем FeedPage — `./presentation`. Не тратить работу на неиспользуемый legacy renderer.

Если активная поверхность отличается от этой карты, записать фактический путь в план и править её. Не делать wholesale перенос в новую папку, новый router или новый UI-version toggle.

## 2. Запрещённые изменения

Сервер, Prisma, SQL, public contracts, auth services, MAX import/caption/date, query keys и алгоритмы кэша, private media endpoints/SW, source identity/deduplication, family ACL, membershipEpoch semantics, seen baseline, upload queues, image source cache, runtime deploy guards — вне scope.

Не менять `shared-author-avatars`, `video-lifecycle`, media playback coordinator и providers ради дизайна. Важные стабильные исправления нельзя потерять: одна загрузка аватара автора для многих карточек; остановка и освобождение видео вне экрана; forward captions; MAX session replacement и recovery; isolation account/family/epoch; lost-invite-response идемпотентность; поздний refresh семьиA не подменяетB.

Root `App.tsx`/composition root/общие manifests только при строго необходимом presentation wiring с отдельным явным diff-обоснованием; не переименовывать и не чистить архитектуру. Не менять `AGENTS.md`/verification gate в этой UI-задаче, не понижать классификатор ради скорости.

## 3. План — три реализуемых блока, без трёх релизов

### A. Общие primitives, header/nav и семья

1. Зафиксировать текущий source и baseline screenshots на тех же тестовых данных.
2. Прочитать reference HTML/CSS и SPEC, составить компактный список actual renderer paths.
3. Настроить scoped Typography/tokens; никаких каскадных правил на все `h1`, `p`, `button`, `img` приложения.
4. Применить96px иллюстрированный header,62px nav, семейный профиль/list/invite/channel.
5. Проверить 320/390/430, длинные имена,2/10 участников, Owner/Full/Viewer, отсутствие двойного safe inset.
6. Зафиксировать один осмысленный commit. Не просить владельца согласовать каждый отступ.

### B. Лента/медиа/реакции

1. Добавить чистые tests ratio helper: single/photo album/mixed/invalid metadata, clamp0.8–2.4, стабильность между слайдами.
2. Убрать внешние карточки, применить author/time/date/caption/reaction layout.
3. Подключить helper только к визуальному aspect-ratio: не менять DTO и media engine. Input — текущие ordered attachment kinds и уже известные display dimensions; output — конечное положительное число.
4. Привести audio/video controls к SPEC, сохранив настоящие media элементы, связи coordinator и ref.
5. Проверить photo/video mix, fullscreen swipe/pinch/seek, pause/unload, long press и реакцию с реальным pending/failure callback.
6. Сохранить state при семейной навигации и повторном открытии viewer. Один commit.

### C. Состояния и финальная приёмка

1. Применить те же primitives к существующим dialogs/forms/errors, не удаляя поля и actions.
2. Проверить state matrix SPEC. Отсутствующий в эталоне flow сохраняет свою структуру и получает заданные tokens; новая функция не добавляется.
3. Получить фактические screenshots активного React UI на детерминированных synthetic DTO. Сравнить с HTML-эталоном на той же среде. Зафиксировать named A1–A5 exceptions.
4. Выполнить необходимые functional regressions, typecheck/lint/build/architecture и применимый verifier.
5. Один независимый read-only reviewer финального presentation diff и доказательств. Один bounded fix/recheck подтверждённых замечаний; не повторять старый аудит backend.
6. Открыть один implementation draft PR с before/after/overlay, numeric rect table, state matrix и точным verified SHA.

## 4. Профиль проверок

Не обещать заранее STANDARD для любого diff. Обычно чистая presentation-правка соответствует STANDARD; но текущий классификатор может требовать FULL при затрагивании family/media/platform/critical paths. Выполнить реальный план `verify:local` на окончательном source; флаг не понижает минимум.

Не проводить отдельный FULL после каждого CSS-изменения. Во время работы — узкие тесты и screenshots; перед PR/merge — требуемый профиль на готовом коде. Перед будущим отдельно разрешённым deploy — FULL итогового release SHA, действующие Selectel safeguards и fresh rollback readiness. Старый attestation для другой runtime tree не считается готовностью отката нового UI.

Synthetic API/DB тесты только в подтверждённой принадлежащей задаче `*_test` БД и отдельном storage. Явно задать и проверить `DATABASE_URL` и `TEST_DATABASE_URL`; не наследовать production .env. Не использовать общий Docker prune или чужие worktrees/fixtures.

## 5. Стоп-условия и отчёт

Остановить только затронутую часть при неизвестном контракте, необходимости поменять ACL/миграции/auth/cache/media engine, риске данных или недоступных обязательных проверках. Остальные независимые presentation-части закончить.

Отчёт: task/branch/worktree/base/head; что изменено; что намеренно не изменено; profile/commands/counts/exit; сравнение ключевых pixels; state matrix; один review; реальные устройства BLOCKED, если их нет; ссылка на implementation PR. Не писать «пиксельно готово» по screenshot самого HTML — нужны screenshots работающих React-компонентов.

Не сливать и не деплоить новый UI до показа владельцу финального сопоставления. Это одна граница визуальной приёмки, не цепочка согласований каждого подшага.
