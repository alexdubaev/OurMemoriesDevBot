# MEMOLY-F12-CLOSURE-AND-RISK-BASED-VERIFICATION — план

Task: MEMOLY-F12-CLOSURE-AND-RISK-BASED-VERIFICATION. Lead GPT-6 Codex.
Base `e383d79269a3595f4c6cabedf167335aea042cf3`.

1. Часть A: только оставшиеся сценарии F12 в `fix/max-browser-session-replacement` (published `c308bcbbcc8dba821a7c2ffd4578acd67143d0d2`). Проверить fresh MAX при старой revoked cookie, обычное клиентское восстановление, expired/cancelled browser-link с retry. Read-only comparison #176/#177; не повторять семь старых E2E. При отсутствии дефекта не создавать commit. При подтверждённом дефекте — минимальный fix и regression только в F12.
2. Часть B: отдельный worktree `.worktrees/risk-based-verification`, branch `chore/risk-based-verification` от base. Простой classifier + runner FAST/STANDARD/FULL, консервативный diff, защита от downgrade, точные source SHA/dirty state, dry-run без PASS. Hook сохраняет main/ref/clean/source guards и использует предыдущий remote SHA как baseline.
3. FULL использует MAX и платформонезависимые проверки. Сохранить real PostgreSQL session/ACL/private media coverage; исторические messenger suites исключить явно без удаления production-кода. Короткий MAX Mini App и Web/PWA browser-link E2E вместо исторического emulator.
4. Согласовать AGENTS.md, package aliases, PR template, developer/release инструкции. Перед merge — профиль по риску на точном source; перед production — FULL итогового совместного release SHA. Backup, migration/readiness, Selectel safety и запрет самостоятельного merge/deploy сохраняются.
5. Проверить classifier/runner/hook failure boundaries с synthetic fixture repos; FAST/STANDARD selection и исполнение, FULL на собственной loopback PostgreSQL `memoly_risk_verify_20261017_test`, отдельное filesystem storage. Нет production writes, schema/migrations/ACL edits.
6. Один свежий read-only review нового diff, один ограниченный fix/recheck. Lead проверяет реальный diff и логи. Отдельный draft PR B; #177 остаётся draft, #176 не меняется. Владелец отдельно принимает правила, затем разрешает merge F12 и семейного PR после применимых exact-source checks; FULL перед будущим deployment.

Allowed B paths: root AGENTS/package scripts/hook, scripts/verify* и tests, test-only backend fixtures/runners и MAX E2E/config, PR template, docs/mvp/07_DELIVERY.md, docs/DEPLOYMENT.md, deploy/selectel/README.md, этот план и отчёт. Запрещены production app code, schema/migrations, изменения #176, production операции.
