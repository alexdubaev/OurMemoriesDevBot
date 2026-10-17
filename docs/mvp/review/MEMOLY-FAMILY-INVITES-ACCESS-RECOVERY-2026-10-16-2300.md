# Восстановленное состояние MEMOLY-FAMILY-INVITES-ACCESS-FULL-AUDIT

Сверено 16 октября 2026, 23:00 Europe/Moscow. Это запись состояния до продолжения работы, не итоговая приёмка.

## Git и сохранность

- Remote main, origin/main и HEAD: `e383d79269a3595f4c6cabedf167335aea042cf3`.
- Ветка `fix/family-invites-access-audit`, worktree `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/family-invites-access-audit`.
- Коммитов задачи поверх main: 0. GitHub PR для ветки: нет, проверено через gh. Прикреплённых PR/artifacts: нет.
- Все изменения остались локальными. Другие worktrees не изменялись. Запись агентов приостановлена для инвентаризации.
- Создан дополнительный снимок 26 файлов: `.scratch/recovery-20261016-230036-dede72/`, включая tracked.patch, manifest.json с SHA-256, новые исходники/тесты/документы, три синтетических скриншота и сохранившиеся журналы. Исходные файлы и отчёты не удалены и не перезаписаны при восстановлении.
- Один ранний feed-media лог был перезаписан предыдущим агентом до запроса восстановления; его заявленный pass не считается сохранённым доказательством. Сохранён последний fail и предыдущий полный JSON с 3 passed.

## Выполненное и подтверждённые дефекты

Прочитаны правила, выполнен scoped discovery MAX/PWA, создана изоляция, подготовлен disposable PostgreSQL18 (127.0.0.1:56550), применены 48 существующих миграций только в тестовых БД. Составлены матрица ролей, план и промежуточный аудит. Production ранее проверялся только чтением runtime/config/migration metadata; записей, merge и deploy не было.

- R1: актуальная роль из списка семей не синхронизировалась с members выбранной семьи. Добавлены проекция роли и guarded members refresh с актуальной version; проверены viewer→full→viewer без перезагрузки, прежний membershipEpoch и сохранение alias.
- R2: терминальное приглашение не давало вернуться к обычной работе. Добавлены «Мои семьи» и dismissal; UI неизвестного токена возвращается к hub без accept.
- R3: повтор создания после потерянного ответа получал новый ключ. Ключ теперь относится к операции формы; реальный commit→потеря ответа→retry даёт одну ссылку, новый flow — отдельную.
- R4: истёкшие приглашения оставались активными. Сервер фильтрует expiry без удаления истории; UI фильтрует cached список/счётчик. API regression проходит; полный UI expiry сценарий ещё не завершён.
- R5: post-save read failure смешивался с сохранением. Разделены результаты; UI тест подтверждает saved banner и read-only recovery без повторного PATCH.
- Capabilities/UI видео согласованы с сервером по прямому решению владельца: Owner и Full разрешены, Viewer запрещён. Полный новый App video/mixed сценарий пока не завершён.
- Исправлено состояние MAX browser-link при собственном изменении session epoch; настоящий PWA start→MAX approval→redeem→hub проходил, старые API instance guards сохранены.
- Активный voice handoff переведён на существующий hostBridge.openBot для MAX; отдельный MAX UI тест проходил, неподдерживаемый переход не открывался.

Отдельное наблюдение чтения кода: жизненный цикл media-session cookie при смене MAX-аккаунта требует защитного regression и отдельной оценки владельцем, если понадобится изменение авторизации. Runtime-дефект этим наблюдением не доказан; архитектура не изменялась. Проверки эксплуатации или production-проверки этого наблюдения не проводились.

## Изменённые продуктовые файлы

1. `backend/src/modules/families/application/family-service.ts`
2. `webapp/src/App.tsx`
3. `webapp/src/features/auth/api.ts`
4. `webapp/src/features/auth/provider.tsx`
5. `webapp/src/features/family/FamilyScreen.tsx`
6. `webapp/src/features/family/InvitationScreens.tsx`
7. `webapp/src/features/family/api.ts`
8. `webapp/src/features/family/model.ts`
9. `webapp/src/features/memoly-ui/AddSheetPresentation.tsx`
10. `webapp/src/features/memoly-ui/FamilyPresentation.tsx`

Новые файлы: family `invite-expiry-max.integration.test.ts`, `max-family-audit.integration.test.ts`, `test-support/max-family-audit-server.ts`; `webapp/e2e/max-family-audit.max-e2e.ts` и два standalone config; `webapp/tests/{family-video-capability,max-auth-epoch}.test.ts`; план, промежуточный отчёт и три PNG в `docs/mvp/review/evidence/family-access-max/`. Схема, миграции, lockfile и старые интеграции не изменены.

## Реальные проверки

| Проверка | Результат и граница доказательства |
|---|---|
| MAX family API + expiry, последний сохранённый `.scratch/max-family-audit-integration.log` | 7 pass, 0 fail, 142 assertions, exit 0; изолированный PostgreSQL, synthetic MAX actors |
| Actual App MAX/PWA, `.scratch/max-e2e-handoff.json` | 3 pass, 0 fail, 0 skipped/flaky, 42.6s; до последних расширений media fixtures |
| MAX voice handoff, результат агента | 1 pass, 23.6s, exit 0; до последних изменений harness |
| Последний расширенный App feed/media, `webapp/.scratch/max-owner-feed-media.log` | 1 fail, exit 1, ECONNRESET/остановка test server; текущий расширенный сценарий не принят |
| MAX direct video integration | 21 pass, 0 fail, 93 assertions, exit 0 |
| MAX capture роли/revoke/channel-status, целевой фильтр | 6 pass, 0 fail, 27 assertions, exit 0; остальные тесты не засчитываются |
| MAX capture native voice/video/mixed, отдельный фильтр | 3 pass, 0 fail, 73 assertions, exit 0 |
| Private cache/SW/seen boundary | 11 pass, 0 fail, 39 assertions, exit 0 |
| MAX host-auth race | 3 pass, 0 fail, 20 assertions, exit 0 |
| Auth epoch + video capability boundary | 2 pass, 0 fail, 9 assertions, exit 0 |
| Frontend build, последний результат агента | exit 0; не заменяет E2E |
| Ранний frontend typecheck; architecture check | exit 0; architecture проверил 747 файлов до последних test-support изменений |
| Узкий lint продуктовых изменений/config/двух units | exit 0, 0 errors, 1 warning об intentional epoch dependency |

Результаты разных стадий не суммируются как итог текущего tree. Final stable-tree verification ещё не выполнен. Исторические platform-specific suites не запускались и не засчитывались; полный verify:local не выполнен. PostgreSQL test dependencies остаются сохранены.

## Незавершённое

- Стабилизировать только локальный MAX harness: идентифицировать владельцев оставшихся test-server процессов/занятых портов, не завершать чужие процессы.
- Завершить short App coverage альбома/voice/video/mixed/avatars, full non-owner video, multi-family switching, revoke/rejoin, поздних ответов и cache/account transitions.
- Доделать behavioral red controls R1–R5 и окончательные узкие проверки текущего source tree.
- Одно свежее независимое техническое review, один ограниченный fix pass при необходимости.
- Итоговый отчёт и draft PR. Merge/deploy не разрешены.
- Настоящие iPhone/MAX, Android/MAX и установленная Safari/PWA: BLOCKED без устройств.

## Решения владельца

Видео уже согласовано: **Owner и Full**. Для UI/обычной бизнес-логики дополнительных решений сейчас не нужно. Любые предлагаемые изменения ACL, схемы или архитектуры авторизации будут вынесены отдельно с контекстом и минимальным планом; до решения они не реализуются.
