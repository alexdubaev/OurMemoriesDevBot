# Расследование выпуска комментариев 21 октября 2026

Task: RELEASE-POSTMORTEM. Исходная база `4b4edc0992803b84c919aadb835e8d2e21095c51`.
Это расследование и исправление процедуры, **не новый production release**.
Время ниже — UTC. «Миграция применена», «PR merged», «runtime promoted» и
«release завершён» — разные события.

## Вывод для владельца

Предыдущие миграции проходили не потому, что Selectel никогда не вызывал
`db:deploy`: такой путь выполнялся. В старой базе был парольный администратор,
который удовлетворял унаследованной проверке. Позже его уже не было, а последние
успешные выпуски только проверяли заранее обновлённую схему. Комментарии снова
запустили полный путь; SQL применился, затем чуждое MAX-продукту условие
администратора остановило job до переключения сервисов.

Ошибка агента — принять технический rollback baseline за подходящий плановый
продуктовый baseline, а сообщение общего bootstrap-скрипта — за необходимость
создать привилегированный аккаунт. Следовало сначала исследовать происхождение
этих требований и варианты сохранения принятого UI. Ответственность за этот
выбор остаётся у инженера; запрос владельцу о maintenance не исправляет
необоснованность выбранного решения.

## Доказательства и ограничения расследования

Источники: Git history/blame, PR, сохранённые локальные журналы COM-4 и новая
read-only диагностика существующего Selectel. Артефакты сохранены вне Git в
`.scratch/RELEASE-POSTMORTEM/final-evidence/` и `.scratch/COM-4/final-evidence/`
рабочей среды исполнителя. Ниже приведены имена/хэши, чтобы отличать фактические
логи от пересказа. Семейные записи, идентификаторы пользователей, пароли и хэши
паролей в документ не экспортировались.

Для исторического наличия администратора `pg_restore --data-only --table=users
--file=-` **без подключения к БД** читал сохранённый archive на сервере через
потоковый агрегатор. Он выводил только количества, не строки/credentials.
Backup не восстанавливался ни в production, ни в тестовую БД. Тесты используют
только синтетические данные.

| Утверждение | Доказательство / уровень уверенности |
| --- | --- |
| Проверка password-admin появилась до Selectel | **Факт:** `a99b03c19f45b62dc11d2150fcafd08ccb05cbd3` (20 июля), `backend/scripts/deploy-database.ts` → `assertLoginCapableAdmin`; predicate `role=admin AND passwordHash IS NOT NULL` в `admin-bootstrap.ts`. |
| Это generic web/workspace bootstrap, затем Yandex/DO release | **Факт:** `184d2a2cd9ea43d93fe25de40bf56154fd0ba67d` и hardening `ca25eead7b26c758a831a2361fcf888a10c4b0d5`; cloud runbooks требуют seed первого password-admin и проверку на следующих релизах. Это не требование семейных ролей Owner/Full/Viewer. |
| Selectel подключил общий `db:deploy` | **Факт:** [PR #53](https://github.com/alexdubaev/OurMemoriesDevBot/pull/53), merge `91735e8b1c52cdcd42c0051dad945d96aa9f0db2` 24 сентября; `redeploy.sh:migrate` после ownership/target/backup вызывает общий script. |
| Раньше реальные миграционные выпуски существовали | **Факт:** 67 сохранённых `.env` manifests: 8 `MIGRATION=applied`, 59 `checked` (включая финальный COM-4 и static-only manifest). Applied: `d001a1a`, `847a8aa`, `e62f9a0`, `0bc63ed`, `974f693`, `8e908d1`, `512ab71`, `ed7fe44`. Это сохранённый набор, не гарантия полной истории всех попыток. |
| Успех старого пути объясняется реальным администратором | **Факт:** backup до и после PR #53: 1 admin с password; backup перед последним recorded `applied` `ed7fe44` (1 октября): тоже 1. В реально сохранённом image `memoly-backend:ed7fe4481f8564cea16a73060604e668d2b545e8` read-only проверен тот же вызов `dependencies.assertAdmin` и password predicate. |
| Позже администратора не было | **Факт:** backup `postgres-3bac37c7199aba6c39d340ef1e588318964bf8c8-20261003T071748Z.dump`: 0; pre-COM-4 backup 21 октября: 0; текущий read-only count: 0. **Не установлено:** кто, каким действием и точно когда удалил/изменил прежнюю запись. По этим snapshots можно сузить интервал, но нельзя приписать действие человеку или агенту. |
| Последние успешные обновления не исполняли общий db job | **Факт:** manifests после 1 октября имеют `checked`; `ci-release.sh` вызывает migrate только при `RUN_MIGRATION=true`. Ledger показывает новые migrations до соответствующих checked-releases. **Не установлено:** точные отдельные команды применения SQL 2–3 октября — per-attempt журналы не найдены; не называем их выполнением общего `db:deploy`. |

Контрольные evidence SHA256:

- `production-history-readonly.log`: `831544ea621d0a53b86b9f9e72b52b5c0a81856a75a74b814745025d758a68a9`.
- `historical-admin-aggregates-readonly.log`: `9c05edb66e1a2d8e8e3b62b54373b05397e4518e6e65bf87172936c1517712ee`.
- `historical-later-admin-aggregates-readonly.log`: `ace715027d8bf867ce1c8b621f4bb82c1ad3eec6279de48fb02d39c807031305`.
- `historical-image-readonly.log`: `bd5fe67176cfdf9013a360587c5f6317b2d39902d1ff5431eef2c2262f577e8d`.
- `history-ledger-readonly.log`: `6c14687c144b606d360235e3df9f0c9f21290a92642f6ef4e9112277b6dda66e`.

## Фактическая последовательность COM-4

| Событие | Факт / источник |
| --- | --- |
| До COM-4 | [#180](https://github.com/alexdubaev/OurMemoriesDevBot/pull/180) дал проверенный старый rollback pair `3fce273`; затем [#185](https://github.com/alexdubaev/OurMemoriesDevBot/pull/185) принял UI v4 (`afdb408`). [#187](https://github.com/alexdubaev/OurMemoriesDevBot/pull/187), [#190](https://github.com/alexdubaev/OurMemoriesDevBot/pull/190), [#191](https://github.com/alexdubaev/OurMemoriesDevBot/pull/191) приняли комментарии. Это merges, не подтверждение production promotion. |
| Начальная диагностика | Host checkout `af606f9`, API `4ce2006`, jobs `af606f9`, static `a52ba97` (уже принятый v4 preview). Прямой guarded release отвергал mixed images/ancestry/attestation. `HANDOFF.md` COM-4 и [#192](https://github.com/alexdubaev/OurMemoriesDevBot/pull/192). |
| 05:01 / 06:10 | #192 merged `dbb98a9`; [#193](https://github.com/alexdubaev/OurMemoriesDevBot/pull/193) закрепил продолжение после конкретного согласования. Они не устраняли MAX/admin procedure mismatch. |
| 06:12 | Старый rollback-readiness для `af606f9 → 3fce273` exit 0. Это доказывало совместимость/доступность артефактов, **не необходимость UI downgrade**. `CONTINUATION_CHECKPOINT.md`. |
| Около 06:30 | После отдельного maintenance-согласования выполнен guarded rollback всех четырёх сервисов на `3fce273`, включая frontend до v4. Первый bounded attempt остановился на отсутствующем public host до recreation, последующий завершился. Новая миграция ещё не выполнялась. Владелец отдельно оспорил продуктовый downgrade в [комментарии #192](https://github.com/alexdubaev/OurMemoriesDevBot/pull/192#issuecomment-6309639404) (актуальный комментарий доступен в PR). Согласование простоя не должно подменять обоснование отказа от принятого UI. |
| 07:15 | [#194](https://github.com/alexdubaev/OurMemoriesDevBot/pull/194) merged `f37a6a5`: comments→old runtime attestation + compatibility tests. |
| 08:56:55 | Comments migration `20261020173000_memory_comments` успешно завершилась (ledger). Следующий `assertLoginCapableAdmin` остановил job exit 1 **до promotion**. `approved-comments-production-release.log/.exit`, `comments-migration-failure-readonly.log`; все четыре сервиса оставались `3fce273`. Предложение создать admin было ошибочным и впоследствии отозвано; аккаунт не создан. |
| После отказа | Дополнительный read-only preflight обнаружил 25 LF и 24 CRLF исторических checksum при неизменном SQL. Это нормальная допустимая Prisma семантика, но новый raw-checksum guard её не учитывал. |
| 09:29 | [#195](https://github.com/alexdubaev/OurMemoriesDevBot/pull/195) merged `4b4edc0`: guard принимает только два source-derived LF/CRLF checksum для каждого точного migration name, сохраняя отказ на изменённый SQL/duplicates/unfinished/missing/extra rows. |
| 10:03:13 | Отдельно разрешённый release `4b4edc0`, при уже current schema, завершился exit 0; API/jobs/static promoted, health/smoke/manifest подтверждены. Это был recovery завершённой DDL, а не исправление будущего миграционного пути. |
| 10:21 | В рамках этого расследования **только read-only**: checkout `4b4edc0` clean, четыре точных image IDs прежние, 0 restarts; release lock свободен; свободно 4,920,651,776 bytes (>4 GiB). |

Локальные ошибки Windows POSIX/UID и заполнение C: были реальными проблемами
среды, но не причиной password-admin mismatch. Они решались изолированным Linux,
восстановлением сборки и освобождением места. Их нельзя использовать как
объяснение ошибочного продуктового или security-решения. Исторические выводы
разных checkpoints не складываются в «всё было успешно»: поздний успех не
меняет exit 1 первой миграционной попытки.

## Первопричины и пробелы защиты

1. **Код:** один общий migration/bootstrap workflow навязывал MAX-only Selectel
   постусловие generic password-admin. Безопасные DB ownership/ACL проверки были
   смешаны с продуктово-зависимым условием. `migrate` скрывал stderr и называл любой
   отказ «database migration failed», даже после успешно записанного ledger.
2. **Тесты:** real-PG comments compatibility запускал `prisma migrate deploy`
   напрямую. Deployment integration проверял ownership/grants, shell harness
   моделировал Docker db job успешным ответом. Ни один не воспроизводил полный
   Selectel CLI на существующей MAX-БД без password-admin и последующий retry.
3. **Review:** reviews #192/#194 проверяли scoped diff/attestation и приведённые
   gates; несовместимость унаследованного postcondition находилась вне нового
   diff и вне тестового сценария. Отчёты reviews не доказывают, что её исследовали;
   нельзя приписывать reviewer знание отсутствующего production fixture.
4. **UI/recovery:** точная техническая attestation пары старых образов не содержала
   продуктового инварианта v4. Плановая нормализация превратилась в аварийный
   fallback без доказанного исключения вариантов сохранения v4. Не доказано,
   что альтернативный mixed frontend/backend был безопасен; отсутствие такого
   доказательства требовало forward investigation, а не выбора старого UI по
   удобству имеющегося rollback.
5. **Инструкции/решения:** autonomy уже требовала расследовать препятствия, но
   не было конкретной обязательной проверки происхождения неожиданного release
   prerequisite и отделения downtime от product downgrade. Агент эскалировал
   предполагаемое решение до завершения такого расследования. Это ошибка
   исполнения, а не отсутствие разрешения владельца на диагностику.

## Внесённая защита и проверяемые границы

- Отдельный `backend/scripts/deploy-selectel-database.ts` выбирает типизированную
  процедуру существующего MAX Selectel. `MAX_ENABLED=true` обязателен; admin seed
  запрещён до подключения к БД. Общий cloud CLI сохраняет password-admin gate.
  Это не новая auth surface и не операторский `skip admin` switch.
- Общие ownership, реальный Prisma ledger и атомарные grants/default PUBLIC ACL
  сохранены. Ошибки Selectel сообщают фиксированный безопасный этап; неизвестный
  результат DDL не выдаётся за неизменившуюся БД. Секретные raw errors не печатаются.
- Добавлена exact attestation совместимого rollback на действующий v4 `4b4edc0` с реально проверенными image IDs; новый database-procedure runtime не требует возвращаться к старому UI. Unknown product source по-прежнему отклоняется.
- Planned candidate должен включать принятый v4. Любое переключение при rollback/rollback-static также требует v4 до production mutation. Пути согласования downgrade нет: действующий UI сохраняется, при отсутствии совместимого v4 rollback нужен forward fix. Readiness не переключает сервисы и не даёт PASS для запрещённого UI target. Остальные image/data/compatibility/forward-only guards сохранены.
- [AGENTS.md](../AGENTS.md) задаёт каноническую продуктовую/эскалационную политику;
  repository teamlead skill ссылается на неё. [DEPLOYMENT.md](DEPLOYMENT.md) разделяет
  сценарии, [Selectel README](../deploy/selectel/README.md) задаёт операционный путь.
- Глобальный Codex `AGENTS.md` дополнен универсальным правилом расследования до
  предложения новых привилегий/смены auth/product rollback. Старые 11,825 bytes
  сохранены byte-for-byte; добавлено 1,403 bytes. Новый ephemeral read-only CLI
  без file/tool calls процитировал новое правило, exit 0. Это локальное доказательство,
  не проверка облачного окружения. Глобальный файл в Git не включён.

Реальные regression boundaries:

- `backend/scripts/comments-release-compatibility.integration.test.ts`: существующие
  48 migrations + синтетические MAX-family rows → реальный Selectel CLI → comments
  migration → отказ grants → повтор CLI. Ledger/checksum/finished_at неизменны,
  данные и user count сохранены, password-admin не появляется; cloud CLI на этой
  же БД отвергает отсутствие admin. Далее реальные current→old→current clients
  проверяют совместимость/data integrity.
- `backend/scripts/deploy-database.integration.test.ts`: preconditions до connection,
  cloud postcondition, существующие реальные ownership/DDL/DML/privilege проверки.
- `tests/selectel-deployment-ownership.test.mjs`: target validation и backup-before-job,
  отказ backup до запуска dedicated CLI.
- `tests/selectel-release-exit.test.mjs` и `selectel-prebuilt-release.test.mjs`:
  реальные Bash guards/controlled subprocess fixtures, точные IDs/SHA, отказ
  pre-v4 target до mutation и обязательный v4 в planned/recovery paths.

Эти файлы уже входят в tools/MAX integration mandatory catalogs; дополняется
существующий проверяемый путь вместо отдельного необязательного тестового режима.
Финальный обязательный gate: `bun run verify:local --profile full` в clean native
Linux checkout на точном опубликованном HEAD. Результат, source/tree, exit code,
review и merge публикуются в PR этой задачи, а не выводятся из старых FULL.

## Остаточные ограничения

- Не найден audit trail удаления прежнего администратора и отдельных SQL-команд
  2–3 октября. Не создаём фиктивную историю и не исследуем приватные строки ради неё.
- Для memoLy допустим только UI v4 и его принятые потомки, включая восстановление. При отсутствии совместимого v4 rollback нужен forward fix; неизвестный runtime по-прежнему требует новой проверенной attestation. Права на production restart, backup restore или новые аккаунты из этого расследования не следуют.
- Production этим исправлением не обновляется: после merge потребуется отдельно
  разрешённый выпуск с FULL exact release SHA и всеми обычными guards. Физическая
  iPhone/MAX приёмка остаётся отдельной фактической проверкой владельца.

**В рамках RELEASE-POSTMORTEM:** production migration NONE; deploy NONE; service
restart NONE; auth/account/family-data changes NONE; backup restore NONE.