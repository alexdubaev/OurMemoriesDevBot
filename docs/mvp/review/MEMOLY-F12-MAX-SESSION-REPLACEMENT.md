# MEMOLY-F12-MAX-SESSION-REPLACEMENT

Status: REVIEW. Не является разрешением на merge/deploy. Lead: GPT-6 Codex.

## Source и изоляция

- Fresh main/base: `e383d79269a3595f4c6cabedf167335aea042cf3`.
- Audited product commit: `e58d75d4897de97dd05647845b536e75d32214b4`. Все проверки финального product tree выполнены до его commit; последующие изменения только в документации не требуют повторного запуска неизменённых тестов.
- Branch: `fix/max-browser-session-replacement`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/max-browser-session-replacement`.
- Новая owned DB: `memoly_f12_sessions_20261017_a91f_test`, current user `memoly_f12`, PostgreSQL 18 container `memoly-f12-pg18-20261017-a91f`, label `memoly.task=MEMOLY-F12-MAX-SESSION-REPLACEMENT`, только loopback `127.0.0.1:56570`.
- Все 48 существующих миграций применены только к этой новой DB. TEST_DATABASE_URL и DATABASE_URL задавались явно; имя/current user проверены перед fixtures. Новые тесты требуют точного assigned URL и совпадения двух переменных, не пропускаются при отсутствии окружения.
- Старые audit DB/storage/logs и worktree PR #176 сохранены. Новые synthetic fixtures и UUID storage roots не удаляются. Production не использовался.

## Первопричина и изменение

Media cookie содержит JWT, привязанный к auth session. Каждый защищённый запрос проверяет актуальную auth session и членство семьи. MAX exchange получал refresh cookie, но использовал её только для replay matching; fresh exchange создавал ещё одну session и оставлял прежнюю active. Browser-link redeem не получал прежнюю refresh cookie браузера. Logout B завершал только B, поэтому cookie A продолжала проходить серверную проверку A.

Теперь MAX exchange и browser-link redeem получают серверные хеши представленного refresh credential. В выдающей транзакции PostgreSQL блокируется найденная auth session, повторно проверяется точный current hash либо точный immediately-previous hash в существующем grace window. Одного family locator недостаточно. Создание successor, запись MAX replay/consume browser-link и отзыв только predecessor выполняются одной транзакцией. Ошибка/отказ откатывает изменения, Set-Cookie выставляется только после успешного возврата сервиса.

Session ID не принимается от клиента. Не используется поиск по userId, IP, User-Agent или «всем сессиям пользователя». Независимое устройство имеет другую AuthSession/credential family, которую запрос не предъявлял и код не отзывает. Browser-link использует credentials браузера, а не refresh cookie MAX-устройства подтверждения.

Узнаваемый revoked/stale credential не выдаёт ещё один successor при конкурирующем запросе. Повтор того же MAX payload с действующей соответствующей session переиспользует её без новой refresh cookie. Fresh проверенный MAX-вход с точным ещё присутствующим credential истёкшей, но не revoked session может завершить её и получить новую session; expired/absolute-expired session нельзя оживить replay-входом. Эта граница отдельно воспроизведена тестом.

JWT/refresh форматы, cookie Path/SameSite/Secure/TTL, origin/CSRF проверки, семейные роли/ACL, media routes/players/cache и UI не меняются. Старый JWT/media cookie после замены отвергается через существующую проверку session revokedAt. Уже загруженные локальные буферы не уничтожаются этим исправлением.

## Изменённые пути

Только backend auth:

- `application/max-auth-service.ts` — передаёт server-derived predecessor proof вместо предварительно вычисленного session ID.
- `application/browser-link-service.ts` — получает browser refresh credential, передаёт тот же proof.
- `application/ports.ts` — внутренние типы proof/result.
- `infrastructure/auth-repository.ts` — транзакционный proof/row lock и отзыв точного predecessor; только MAX/browser-link paths и новый helper.
- `transport/routes.ts` — передаёт существующую refresh cookie в redeem.
- `index.ts` — существующие grace/absolute TTL зависимости browser-link.
- Новый `max-session-replacement.integration.test.ts` — отдельные signed-MAX/PG/API regressions.

Generic refresh/logout production code, другие адаптеры, shared contracts, schema/migrations, package/lockfile и root release config не менялись.

## Red/green и проверки

Логи находятся в ignored `backend/.scratch/f12-session-replacement-logs/`; содержат статусы/ошибки и результаты assertions, без cookies, JWT и содержимого файлов.

| Проверка | Реальный результат |
|---|---|
| Fresh main F12 regression до production edits | 1 fail, exit 1: защищённый HEAD с media cookie после B дал 200 вместо 401; `red-fc455044-b445-4046-965a-ed1e517b7767.log` |
| Совместимость fresh MAX reauth с exact expired cookie до корректировки | 6 pass / 1 fail, exit 1: новый проверенный вход дал 401; `red-expiry-0830a228-b44d-417c-9856-4a8d711845ab.log` |
| Worker после исправления основной логики | 8 pass / 106 assertions, exit 0; `green-final-f04a320c-897d-4e9b-a564-21e5acf3c0a8.log` |
| Lead повтор того же набора | 8 pass / 105 assertions, exit 0, 1.20s; `lead-verify-20261017-a19d.log`. Число assertions различается из-за допустимых исходов конкурентного refresh/logout |
| Lead backend typecheck | exit 0; `.scratch/f12-backend-typecheck-lead-a19d.log` |
| Architecture / diff check | exit 0; architecture 745 source files |
| Lock-order regression до исправления | 1 fail, exit 1: PG `40P01 deadlock detected`, redeem 500 вместо 401; `review-lock-order-red-891b4022-ed8b-4870-9a4e-8ba8b63af0c6.log` |
| Worker после ограниченного lock-order fix | focused 1 pass / 9 assertions; полный новый файл 9 pass / 115 assertions, exit 0; `review-lock-order-green-full-7166a71d-a51e-431d-aed1-c0d76e57515f.log`; backend typecheck/diff check exit 0 |
| Lead проверка финального product tree | 9 pass / 114 assertions, 0 fail, exit 0, 1.286s; `lead-final-20261017-b47f.log`; architecture 745 source files и diff check exit 0 |

Начальные ошибки настройки child fixture сохранены, не выдаются за F12 red. Финальный primary test использует настоящий PNG upload/finalize, готовый child profile, опубликованную memory и реальный original-media GET; искусственная playback rendition не используется. Для baseline red сохранён точный метод HEAD, не называем его GET.

| Требование | Исполняемое покрытие |
|---|---|
| A: F12 A→B | media cookie до замены GET 200, после 401; old bearer 401; B 200; logout B 204; old media по-прежнему 401; session revoked flags |
| B: независимое устройство | отдельная A session и её собственная playback cookie читают тот же PNG после замены X и после logout B |
| C: неуспешный вход | invalid MAX, wrong origin, invalid verifier: отказ без Set-Cookie, old session продолжает работать |
| D: тот же пользователь | fresh MAX payload заменяет X, Y остаётся; same-payload active replay не создаёт cookie/session; старый revoked credential не выпускает новую identity |
| E: browser-link | штатные start→signed MAX approve→verifier redeem с A в браузере и B на отдельном MAX-устройстве; old A отказ, browser B и approver B действуют |
| F: восстановление | обычный refresh, current/previous grace, logout; idle/absolute-expired exact credentials допускают fresh reauth, но не replay |
| G: конкуренция | MAX/MAX, MAX/redeem, MAX/logout, refresh/logout, MAX/refresh на реальном PG; loser не устанавливает новую cookie и не оживляет old session |

Это backend integration через настоящие Hono Request/Response, Prisma/PostgreSQL и filesystem. Это не проверка реального MAX WebView или PWA browser cookie jar. Никакие тесты других платформ не запускались и не засчитывались.

Команда из `backend/` после явного назначения обеих DB переменных:

```powershell
$env:TEST_SKIP_DOCKER = '1'
bun test src/modules/auth/max-session-replacement.integration.test.ts
bun run typecheck
```

Для этой задачи TEST_DATABASE_URL/DATABASE_URL указывают на новую named DB выше, с synthetic task credentials. Не брать URL из `.env`. Сам тест проверяет host/port/name и равенство URL до любых writes. `bun run architecture:check` выполняется из корня worktree. DB, storage и логи сохраняются.

## Review

Один свежий независимый read-only reviewer `f12_independent_review` не нашёл P0/P1/P2. Отметил P3: нет отдельной проверки expired/cancelled browser-link при сохранении старой session. Тесты reviewer не запускал.

Lead при проверке сопряжённого lock protocol нашёл P2: новый browser-link порядок session row→user authority конфликтовал с существующим authority→session row при административном завершении сессий. Один ограниченный pass воспроизвёл deadlock на real PG и переставил существующий authority lock перед predecessor lock. Код users/ролей не изменялся. Тот же независимый reviewer выполнил только узкую read-only closure и подтвердил устранение P2; тесты reviewer не запускал. Второго whole-change review не было. P3 expired/cancelled browser-link остаётся явно указанным пробелом автоматического покрытия; invalid verifier и invalid MAX проверены.

## PR #176 и release gate

Опубликован отдельный draft [PR #177](https://github.com/alexdubaev/OurMemoriesDevBot/pull/177) из этой ветки. Audited product commit указан выше; последующие commits — только отчёт/план. Merge/deploy не разрешены этим отчётом.

Это независимое исправление от main; код PR #176 не копировался, не cherry-pick/merge и его branch/worktree не менялись. У #176 backend изменения только families; клиентские auth epoch corrections находятся в webapp. Файлы production этого PR с ним не пересекаются. Рекомендуемый безопасный порядок владельцу: отдельно принять P1 server fix, затем после своей приёмки #176; после обоих выполнить совместный MAX/browser-link smoke на актуальном source. Слияния этой задачей не выполняются.

`bun run verify:local` НЕ запускался и не считается пройденным. Он запускает default backend/webapp suites и critical browser journeys, содержащие историческую неподдерживаемую платформу. Перед будущим merge требование остаётся обязательным. Отдельное предложение: согласовать MAX-only release profile, который сохраняет typecheck/build/architecture, supported MAX/API/browser journeys, собственные явные disposable DB и отказ при отсутствующих/skipped required tests; убрать исторические suites из активной приёмки явным изменением gate, а не локальным обходом. Root scripts/CI в текущем auth fix не меняются. GitHub Actions не добавляются.

## Физическая приёмка и ограничения

BLOCKED: физических устройств и разрешённого deployment этого source нет. На отдельно разрешённом тестовом окружении с синтетическими MAX-аккаунтами владельцу проверить:

1. iPhone/MAX и Android/MAX: A открывает тестовое media, затем переключается на B и выходит; следующий защищённый запрос со старым контекстом требует входа/получает отказ. Уже загруженный буфер — не новый запрос.
2. Web/PWA: MAX browser-link A→B в том же браузере; A на другом устройстве продолжает открывать свою тестовую семью/media. Затем logout B.
3. Повторный вход A, refresh/reopen, отмена/сетевая ошибка переключения и две вкладки; старые ответы не должны восстанавливать прежнюю серверную session. Это не обещание атомарной доставки HTTP responses: транзакция гарантирует server-side invalidation, существующие client Web Locks/epoch guards остаются прежними.

## Rollback

До merge — закрыть draft PR. После отдельно разрешённого merge — revert code commit через новый PR с целевыми локальными проверками. Нет schema migration/DB restore. Уже отозванные session rows не оживлять SQL-операцией; их владельцы проходят обычный новый MAX-вход. Production deploy/migrations/data writes не выполнялись.

## Closure 2026-10-17 — MEMOLY-F12-CLOSURE-AND-RISK-BASED-VERIFICATION

Эта секция уточняет предыдущее состояние: найден и исправлен дополнительный клиентский дефект. Product commit closure: `383d95e56f5af881ad3d15aff7dda7d26206c999` (после опубликованного `c308bcbbcc8dba821a7c2ffd4578acd67143d0d2`). Ветка и base прежние; allowed paths: auth client API, его узкие тесты, существующий F12 integration и этот отчёт. Schema/migrations, семейные ACL и server auth production code в closure не менялись.

### Подтверждённая причина и исправление

Потерянный ответ с новой Set-Cookie оставлял в браузере доказанную, но уже отозванную predecessor cookie. Fresh signed MAX exchange правильно отказывал (401), однако обычный refresh/bootstrap не удалял HttpOnly cookie. Новые входы повторяли тот же отказ. Red: A→B replacement→fresh A с сохранённой revoked cookie дал 401 вместо восстановления.

Теперь AuthApi после authoritative refresh 401 удаляет cookie через существующий logout, удерживая существующий auth coordinator и проверяя session epoch. Normal bootstrap затем допускает новый browser-link flow. Для прямого MAX entry есть один ограниченный recovery/retry после отдельного подтверждения refresh 401. Active refresh session при отказе MAX не удаляется. Серверный отказ для replay/revoked/stale proof сохранён. Запоздалые ответы не применяют token к новому epoch; abort/network/5xx не считаются подтверждённым истечением сессии.

### Проверки и границы доказательств

- Новый integration использует настоящие AuthApi/HttpClient/bootstrap, Hono, Prisma/PostgreSQL и синтетический cookie jar: `/max 401 → refresh 401 → logout 204 → max 200`, затем normal bootstrap `refresh 401 → logout 204 → browser-link start/approve/redeem 200`. Проверены cookie progression и `/me 200` без ручной очистки browser storage.
- Lead: `bun test src/modules/auth/max-session-replacement.integration.test.ts` из backend: **10 pass / 0 fail / 132 assertions, exit 0, 1.57s**; `.scratch/lead-f12-closure-integration-final.log` в корне worktree. Выполнено на том же product tree до commit; после этого изменена только обработка abort/5xx retry, проверенная узко ниже.
- Lead после review fix: `bun test webapp/tests/max-auth-stale-cookie-recovery.test.ts`: **8 pass / 0 fail / 24 assertions, exit 0, 73ms**; `.scratch/lead-f12-client-review-closure.log`.
- Worker: backend typecheck, webapp typecheck/build/lint — exit 0. После P2 исправления web typecheck — exit 0. `git diff --check` / staged diff check — exit 0.
- Expired browser-link: redeem отказал, прежняя действующая session сохранилась, новый flow завершился. Отменённый сценарий — отказ пользователя/оставленный pending challenge до redeem: session не заменяется, новый flow работает. Отдельного cancel endpoint в текущем механизме нет. Узкий временный proof с существующими helpers: **11 pass / 135 assertions / exit 0, 1.639s**. Старые семь E2E не повторялись.
- PR #176 auth epoch test: **1 pass / 4 assertions / exit 0**. Read-only сравнение актуального closure product commit с #176 `6b796b6a9776535a33323e8e39022d17c7bd5369`: merge preview exit 0, conflict markers 0. Оба изменения auth/api сохраняются; shared/public contracts не меняются. MAX-вход предшествует invite acceptance, browser-link выдаёт обычную MAX session; F12 не меняет family roles/membership epoch, family reopen или независимые устройства. Это подтверждение стыка diff и узких тестов, не FULL совместно слитого source.
- Один свежий независимый reviewer проверил только новый diff. Найденный P2: retry abort/5xx ошибочно очищал auth state. Один bounded fix и узкая closure: P2 закрыт, новых блокирующих findings нет. Старый server F12 повторно не ревьюился.

Integration guard теперь требует одинаковые явно назначенные DATABASE_URL и TEST_DATABASE_URL, loopback host, явный port, имя `*_test`, schema public. Это позволяет будущему FULL запускать тест на своей изолированной БД вместо жёстко заданной старой task DB. Секреты не входят в Git; owned environment handoff находится в ignored `backend/.scratch/f12-closure-env.json`.

### Статус принятия

PR #177 остаётся **draft / REVIEW**, не Ready и не merged. Реальный дефект исправлен, узкие проверки зелёные; к рассмотрению результата готов. **Разрешение merge и подтверждение FULL на точном актуальном source ещё требуются.** Новый verification gate готовится отдельным PR; его не считаем уже вступившим в силу. #176 не изменён. Порядок: отдельное решение владельца о новой системе → применимые FULL для точных актуальных SHA #177 и #176 → отдельные разрешения merge #177, затем #176 с обновлением от main и проверкой стыка → FULL итогового совместного release SHA перед отдельно разрешённым production deploy. Backup/migration/readiness и Selectel safeguards сохраняются.

Физическая приёмка iPhone/MAX, Android/MAX, Web/PWA: stale-cookie повторный вход, browser-link cancel/expiry/retry, A→B/logout, независимое устройство, invite→family reopen. В этой задаче нет разрешённого deployment или физических устройств; локальная synthetic проверка не выдаётся за такую приёмку.
