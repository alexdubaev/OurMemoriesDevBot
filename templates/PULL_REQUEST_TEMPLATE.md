## Задача
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

UI: ссылки на actual screenshots + сопоставление с ref IDs.
Ревью: исполнитель, head SHA, findings/resolution.

Перед merge указать профиль FAST/STANDARD/FRONTEND/FULL, риск-основание, фактические команды, результат и точный source SHA/tree. FULL обязателен для auth/session, ACL, приватных медиа, schema/data, критических транзакций, публичных контрактов и критической инфраструктуры. Pre-push запускает классификацию относительно remote SHA для main/master; PR merge hook не запускает. Перед production deploy нужен FRONTEND для eligible client-UI static-выпуска с независимыми exact-range receipts для всех R-range либо FULL для остальных runtime-изменений на точном итоговом release SHA; сравни весь diff с deployed backend/frontend SHA по правилу AGENTS.md от 2026-10-22. Укажи release mode, оба deployed SHA и recovery-readiness. Изменения release tooling требуют FULL. Dry-run не является PASS. Недоступные обязательные проверки отмечаются BLOCKED, пропуск не считается PASS.

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
