## Задача
Для малой задачи достаточно заполнить «Задача», «Границы» и фактически выполненные «Проверки»; следующие release/security поля заполняются только когда применимы. Не требуется скриншот, профиль или полный отчёт без соответствующего gate/приёмки.
Task ID:
Пользовательский результат:
Base SHA / head SHA:
Ветка и worktree:

## Границы
Изменённые модули:
Shared contracts/schema/config:
Что намеренно не входит:

## Проверки
| Команда/сценарий | Результат (tests/exit code) | Доказательство |
|---|---|---|

UI screenshots and ref IDs: only for an actual visual acceptance.
Ревью: укажи только когда review required/warranted.

Для малых изменений используй [малый workflow](../docs/development/SMALL_CHANGE_WORKFLOW.md); если применим release gate, укажи профиль FAST/STANDARD/FRONTEND/FULL, риск-основание, полный source SHA/tree, comparison bases, команды, результат и среду. FULL обязателен для auth/session, ACL, приватных медиа, schema/data, критических транзакций, публичных контрактов и критической инфраструктуры. Pre-push запускает классификацию относительно remote SHA для main/master; PR merge hook не запускает. Перед production deploy нужен FRONTEND для eligible client-UI static-выпуска с независимыми exact-range receipts для всех R-range либо FULL для реальных protected runtime/safety changes; малые non-protected изменения следуют affected checkset. Изменения защитной логики release tooling требуют FULL; механическая подготовка metadata подчиняется малому workflow и не заменяет доказательство совместимости. После squash source-bound evidence можно перенести на final SHA только если чистый checkout, полный source/merged tree, bases, scope и dependency/environment inputs совпадают, проверки полностью PASS, нет открытых ошибок/review findings и evidence актуально. Запиши final SHA/tree и результат equality check; явно сообщи, что профиль повторно на final commit SHA не запускался. Иначе повтори затронутые проверки. Общая процедура для всех профилей и host guards описана в [AGENTS.md](../AGENTS.md#перенос-source-bound-evidence-после-squash). Укажи release mode, оба deployed SHA и recovery-readiness. Dry-run не является PASS. Недоступные обязательные проверки отмечаются BLOCKED, пропуск не считается PASS.

## Данные и выпуск
Новые миграции:
Совместимость старого клиента:
Риски приватности/секретов:
Rollback кода и ограничения отката БД:
Известные BLOCKED/непроверенные места:

- [ ] Нет реальных семейных данных/секретов/шрифтов окружения
- [ ] Только назначенный scope
- [ ] Проверки выполнены на текущем head
- [ ] Нет pending разрешений, замаскированных под готовность
- [ ] Merge/deploy выполнены в пределах полномочий; указаны mode, SHA, smoke и recovery либо реальная причина отсутствия выпуска
