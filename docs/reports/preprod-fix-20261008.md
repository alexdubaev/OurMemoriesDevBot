# FIX-PREPROD-2026-10-08 — исправления и локальная приёмка

## Продолжение доставки — RELEASE-PREPROD-20261008

Текущий статус: IN_PROGRESS. Владелец прямо разрешил commit, push и deploy. Task-коммит `dd21d6aeb189eaf05a277d92e127d90e8628927a` опубликован в [PR157](https://github.com/alexdubaev/OurMemoriesDevBot/pull/157), base main `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`. Merge и production-деплой ещё не выполнены.

[Verify37789536271](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37789536271) на точном task HEAD завершился failure: default E2E88 passed,3 failed,35 did not run. Тест failed-like остановился до reaction-request; два семейных сценария исчерпали общий90-секундный timeout при клике по строкам настроек. Причина движения элементов/исчерпания бюджета не доказана. Companion E2E, S3 и Docker smoke не достигнуты. Выполненные предшествующие CI-проверки успешны; отдельный Webapp build объяснимо пропущен FULL plan, обе production-сборки выполнены в Build artifact contract checks.

API артефактов первого прогона вернул0: ссылки на trace/screenshot/error-context существовали только в runner-local журнале. Коммит `08bdf2018263229f42cc816aaf5dd9b89dfc8869` добавил сохранение этих синтетических файлов при падении E2E; upload action закреплён immutable SHA. Проверки YAML, architecture (807 source files), template и diff-check имеют exit0.

[Verify37798236797](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37798236797) на этом HEAD также завершился failure:88 passed,3 failed,35 did not run. Сохранение диагностики успешно:3 traces,3 error contexts,4 screenshots. Lead скачал и независимо сверил SHA256 архива с API: `1fc9cac8563e5d38817f4a11b1cae01f9b5d64a8164b47c92e4b7e2112e87785`. S3/Docker smoke и companion profiles снова не достигнуты; предшествующие selected checks успешны.

Трассировки доказали ошибку семейных тестов: частичное имя «Настройки» выбирало строку «Настройки семьи» в закрывающемся sheet. Lead лично проверил `__playwright_target__=data-settings-row=pencil` при `data-state=closed`, call@2495/call@2598. Страница переходила в family-settings; ожидаемая строка затем отсоединялась примерно через0.93s, а тест ждал отсутствующий элемент до общего90s deadline. Увеличение timeout не требуется. Исправление использует exact accessible name для launcher и сохраняет сценарии/проверки.

Для failed-like trace зафиксировал mouseDown(1064,539) при viewport1280×720; Lead просмотрел ближайший кадр через10ms: фото занимает x≈429..851. Диагностический Ubuntu-прогон воспроизвёл то же промахнувшееся нажатие: elementFromPoint=root DIV, picker0, до reaction request. Источник смещения сырого boundingBox остаётся неизвестным; подтверждена отсутствующая проверка actionability. Тест использует active-slide image и обычный hover перед настоящим mouse hold, затем явно ожидает synthetic503 перед проверкой rollback. Production carousel не меняется.

Uninstrumented focused Ubuntu baseline исходного dd21 прошёл3/3 за1.6m (feed8.5s, app-settings30.9s, management37.4s), exit0; это не отменяет двух CI failures. Измерительные прогоны добавляли время перед действиями и считаются только диагностикой. Итог локальной приёмки исправленного diff приведён ниже; новый remote CI ещё требуется. Логи, traces и Git-archive snapshot находятся в ignored `webapp/e2e/.artifacts/fix/`. Retries, timeout, release-profile и assertions не ослаблены; локальная приёмка ниже не заменяет GitHub CI.

Первый actual-source Ubuntu acceptance исправления:5 passed,1 failed, exit1. Family-management выявил дополнительную ошибку тестовой правки: exact имя намеренной строки «Настройки семьи» не учитывало subtitle. После lead ruling reviewer исправил подтверждённыйP2: три menu-scoped row locators снова используют исходный regex; только launcher «Настройки» имеет exact:true. ESLint/diff-check reviewer и строгий web/E2E typecheck Lead — exit0 после коррекции.

Первый шестисценарный прогон окончательной пары файлов:6 passed за2.8m, `PLAYWRIGHT_EXIT=0`, но после тестов оболочка завершилась2 из-за CR в `exit 0`; это не overall exit0. Неполные discovery/harness attempts сохранены как failures/incomplete, не используются как acceptance.

Финальный actual-source Ubuntu acceptance через literal LF script: discovery6/6; все6 исходных focused scenarios прошли за2.7m, `PLAYWRIGHT_EXIT=0`, `CONTAINER_EXIT=0`. Включены failed-like, native mouse hold, Chromium touch/text-selection safety, onboarding, app-settings и family-management. Lead независимо прочитал `ci-trace-fix/ubuntu-six-acceptance-lf-console.log`, проверил counts/exits и совпадение SHA256 actual-source файлов с readonly mounts: feed `7e46a0f2563e55b280f70983c191d43144d0db065ac9a8b92e30f0d701aa7989`; family `80d7f09f9b1796fe4ee95cd1136bfed6e008c4990eb974134575aed2a49d7a37`.

Повторный actual-source Ubuntu race check через literal LF script: discovery9/9; каждый из трёх CI-failing scenarios выполнен3 раза, `9 passed (3.8m)`, `PLAYWRIGHT_EXIT=0`, `CONTAINER_EXIT=0`. Lead независимо прочитал полный итог stdout и сверил текущие file hashes. Retries0, worker1, timeout90s; новые budgets/sleeps/forced clicks отсутствуют. Новый GitHub Verify на этом diff ещё требуется.

После подтверждённогоP2 и lead ruling выполнено одно final fresh review: новых подтверждённыхP0/P1/P2 нет, code/CI acceptance разделены. Lead лично повторил strict web/E2E typecheck, ESLint2 files, diff-check — exit0; release-verification tooling26/0 (80expects), avatar/Docker smoke unit10/0 (39expects) — exit0, raw logs сохранены. Manifest92 source files по сравнению с `08bdf201` отличается только2 E2E files; production source не менялся в этом продолжении. Report изменён отдельно. Whole-PR review проверил инвентарь и release/race/security/media execution paths, не заявлял построчного аудита каждого asset/fixture.

Windows acceptance текущего E2E diff остановился до тестов: Prisma migration schema-engine error, exit1,0 tests. Lead независимо проверил TCP127.0.0.1:60327=False; mapping принадлежит task-owned PostgreSQL, который healthy и отвечает psql внутри своего контейнера. Это ограничение host-to-WSL соединения, не успешная проверка. Глобальные настройки Docker не менялись. Продолжение выпуска опирается на actual-source Ubuntu acceptance и обязательный полный CI; прежний Windows FULL ниже относится к исходному source freeze и неизменённому production code.

Read-only Selectel preflight подтвердил SSH-доступ, canonical host origin/clean checkout, достаточное место и48 применённых миграций без pending/failed. В этом task нет schema/migration diff, поэтому migration input=false. Следующий выпуск требует green текущего PR HEAD, squash merge, отдельного успешного Verify на точном main SHA, затем штатного `ci-release.sh`, проверки runtime image IDs/revision и публичного smoke. Ограничение zoom и принятое решение о контрасте сохраняются.

## Исходная локальная приёмка до публикации

Локальный статус на исходном source freeze: REVIEW. Подтверждённые дефекты исправлены и проверены локально. Независимое ревью не оставило подтверждённых P0/P1/P2. На момент фиксации этой локальной приёмки публикация, merge и deploy ещё не выполнялись; результаты не являются production-сертификацией.

Task ID: FIX-PREPROD-2026-10-08. Назначение владельца: глубокое code review, гонки, TDD/E2E с субагентами и последующее «Тогда исправляй». Lead: GPT-6; reviewers — GPT-6 Luna High, role-based scout/worker — GPT-6 Luna Medium, первоначальные workers — GPT-6 Luna High. Точный runtime identifier lead недоступен.

- Branch: `fix/preprod-20261008`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007`.
- Base/head: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`; проверен текущий незакоммиченный task diff поверх этого SHA.
- Origin: подтверждён канонический `alexdubaev/OurMemoriesDevBot`. PR / merge SHA: не опубликовано / не слито.
- Schema, migrations и публичные contracts: изменений нет. Production token/calls, реальные приглашения и удаления не использовались.

## Изменения и доказательства

Reservation cleanup теперь берёт family lock перед reservation и освобождает запись условно. Проигравший concurrent cleanup не повторяет counters/side effects. Caption consume блокирует и перечитывает request: committed cancellation не меняет memory, duplicate reply увеличивает version один раз. PostgreSQL barrier regressions сначала воспроизвели три падения, после исправления прошли; полный integration suite также прошёл.

Avatar validator проверяет raster byte signature и MIME до Sharp: SVG, замаскированный под PNG, отвергается без вызова decoder. Sharp, Hono и уязвимые транзитивные зависимости обновлены. Shadcn CLI удалён; точный используемый CSS и MIT notice сохранены в `vendor/shadcn/`. Audit не использует suppressions.

Release gate закрывается при missing/pending/failed Verify, API timeout и более новом failed run. Он требует точный текущий SHA main, canonical workflow и единственный успешный `verify-required` в последнем trusted run/attempt. FULL planner и CI command mapping исправлены. Main protection реально включена после accepted baseline [Verify 37723627116](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37723627116): strict required check, PR, admins enforcement, resolved conversations, linear history, запрет force push/delete, auto-merge off; approvals=0 при единственном владельце. Новый локальный CI diff ещё не проверен на GitHub.

PhotoSwipe закрывается при `memoly:feed-inactive`; listener удаляется при unmount. Regression case24 проверяет отсутствие оставшихся viewer handlers и баланс 7 созданных / 7 освобождённых object URLs. Pending touch при уходе в список семей больше не активирует новую карточку после отпускания: guard удерживает matching release/click, ограничен 900 мс после pointerup, снимается при fresh pointer/cancel/blur/pagehide/click/timeout. Keyboard и посторонние координаты проходят. Естественный touch case52 прошёл три повтора без instrumentation, включая persistence и reload. Reviewer усилил unit coverage; async unit не заявляется как TDD RED до реализации.

При pause/hide голосового сообщения отменённый `play()` Promise больше не создаёт unhandled rejection. AudioPlayer принимает результат только текущей попытки; pause/ended/source change/unmount/new click инвалидируют старую. Ошибка playback оставляет кнопку доступной для следующего запуска. Общий platform media helper не менялся. Три deferred-play regressions проверяют cancellation, stale result и genuine rejection/next play. Worker выполнил behavioral RED с preparatory extraction старого direct-await поведения; исходный RED stdout не сохранён, поэтому он подтверждён tool result/worker evidence, а не отдельным raw log. Root самостоятельно проверил actual diff и GREEN full web unit.

Контраст Family role/info и MAX status/error/action исправлен существующим foreground `#302a2e`; рассчитанные ratios превышают 10.6:1. Frozen reference, backgrounds, fonts, layout и assets сохранены. Старый contrast whitelist удалён. По прямому решению владельца запрет page zoom сохраняется; допускается только exact axe `meta-viewport`, отдельно отражённый в каждом scan. [Решения, исторический эталон и новые цвета](../mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md).

E2E fixtures приведены к принятым welcome/persistence/private-media contracts, точным synthetic bytes/DTOs, реальным PUT и playback при preload=none. Strict E2E/TSX включён в обычный typecheck. Test-only Inter cache проверяет TLS, URL/content/size/deadline, SHA/length и OFL; production font не менялся. Artifact directory исключён из Vite watcher, copied specs — из companion discovery; бюджеты и tolerances не увеличивались. Poster fixture использует synthetic Bearer как production rawAuthenticated; production SW/token не менялся. Carousel screenshot ждёт readiness/active position и окончания движения через animation frames.

Два RED после reload оказались missing test prerequisite: выбранная семья/экран ещё не проверены в IndexedDB перед restart. Добавлены только typed readonly assertions существующей записи feed+family; automatic restore и целевые loading/empty/error/retry/viewer проверки сохранены, fallback выбора семьи отсутствует. Focused case74 прошёл3/3, loading/error matrix —6/6, exit0, no-update (`e2e/feed-case74-repeat-r1.log`, `e2e/matrix-viewer-persistence-repeat-r1.log`).

Docker frozen install слои зависят от manifests/lock; source COPY идёт после install. Smoke создаёт отдельные UUID project/container/network/volume и synthetic DB на свободном порту, игнорирует ambient DB/container overrides, удаляет только собственные resources. Unit сначала RED, затем GREEN; настоящий smoke с foreign sentinels подтвердил их сохранность и cleanup своего проекта.

## Выполненные проверки

Все итоговые строки ниже имеют exit code 0. Evidence paths относительно `webapp/e2e/.artifacts/fix/`, материалы ignored и синтетические. История неуспешных и focused прогонов сохранена отдельно: [evidence history](preprod-fix-20261008-evidence-history.md).

| Команда / проверка | Результат | Evidence |
|---|---:|---|
| `bun run test:backend:unit` | 640 / 0 | `lead/backend-unit.log` |
| `bun run test:backend:integration` | 369 / 0, 32 files | `lead/backend-integration-final.log` |
| `bun run test:contracts` | 56 / 0 | `lead/contracts.log` |
| `bun run test:webapp` | 474 / 0, 74 files, 3265 expects | `lead/webapp-unit-final-r2.log` |
| `bun run test:infra` | 124 / 0 | `lead/infra-final.log` |
| `bun run test:website` | 7 / 0 | `lead/website-unit.log` |
| `bun run test:verification-tools` | 26 / 0 | `lead/verification-tools-final.log` |
| `bun run test:storage:s3` | 16 / 0 | `lead/s3-live.log` |
| `bun test backend/scripts/docker-smoke.test.mjs` | 3 / 0, 20 expects | `lead/docker-smoke-unit-final-r3.log` |
| `bun run test:build-contracts` | 3 / 0, обе production сборки | `lead/build-contracts-final-r2.log` |
| Root typecheck + strict E2E | все workspaces, 0 errors | `lead/typecheck-final-r3.log` |
| Lint / architecture / template | 0 errors; architecture807 files | `lead/lint-final-r6.log`, `lead/architecture-final-r4.log`, `lead/template-final-r5.log` |
| Frozen install / audit | 935 packages; known advisories0 | `lead/dependency-audit-final.log` |
| Windows default E2E, no-update | 126 / 0, 0 skipped, 27.1m | `e2e/default-final-r4.log` |
| Windows poster E2E, no-update | 6 / 0, 0 skipped, 2.0m | `e2e/poster-final-r7.log` |
| Windows warm-cache E2E, no-update | 1 / 0, 0 skipped, 50.8s | `e2e/warm-final-r2.log` |
| Linux poster E2E, no-update | 6 / 0, Chromium3 + WebKit3 | `../linux-poster-repeat-20261008/artifacts/linux-poster-six-r3.stdout.log` |
| Natural voice cancellation, repeat3 | 3 / 0, 41.2s | `e2e/voice-case68-repeat-final-r1.log` |
| Fresh Docker build / runtime / DB smoke | health/ready, challenge/cookie/status passed | `lead/docker-smoke-owned-final-r2.log`, `lead/docker-smoke-owned-final-r2-summary.json` |
| Source freeze / diff check | 92 hashes unchanged; exit0 | `lead/source-freeze-verification-final-r2.json`, `lead/diff-check-final-r4.log` |

Сумма последнего deterministic набора — 1718 test executions; это не число уникальных бизнес-сценариев. Итоговый Windows release batch выполнен последовательно одним browser owner: из `webapp` `bun run e2e -- --update-snapshots=none --output e2e/.artifacts/fix/e2e/default-final-r4-results`, затем такой же вызов с `--config e2e/private-video-poster.playwright.config.ts` / `poster-final-r7-results`, затем с `--config e2e/warm-navigation-cache.playwright.config.ts` / `warm-final-r2-results`. Буквальный root `e2e:webapp:release` не запускался; проверены его три компонента с запретом обновления snapshots. Итого Windows133/0, 0 skipped, все три observed exit markers0 и .last-run passed; root лично сверил summaries/list entries/markers, unhandled rejection lines0. Aggregate evidence: `lead/windows-final-batch-summary.json`. Focused соседние family cases98/99 также прошли6/0, exit0, 2.9m (`e2e/family-worker-crash-repeat-r1.log`).

Agent K в итоговом default run: 42 unique scans, contrast0, unapproved0, acceptedviewport42; root summary `lead/accessibility-default-final-r4-summary.json`. Passing axe с принятым запретом zoom не означает полного WCAG compliance. Existing Astro `verticalAlign` deprecation hint не блокирует typecheck.

## Независимое ревью и визуальная приёмка

Первое whole review выявило три P2 CI completeness; они исправлены, следующее review подтвердило. Позднее fresh whole review выявило P2 shared Docker DB cleanup; lead подтвердил finding, reviewer исправил bounded scope, root проверил actual diff, unit и настоящий Docker runtime. Финальный fresh reviewer `review_final_preprod_adjudicated` проверил whole active diff и не оставил P0/P1/P2; source edits/tests не выполнял. Его первоначальный label production_ready отозван: принято только static review clear, runtime evidence отдельно проверен lead.

После voice/persistence правок выполнены два новых независимых whole reviews: `review_preprod_voice_and_whole_final` и `review_preprod_whole_final_second`, подтверждённых P0/P1/P2 нет. Reviewer отозвал предположение о pre-validation исполнении release SHA после проверки фактического порядка pinned checkout → fixed SHA/current-main validation → Node. Предположение о touch-target replacement после pointerup не подтверждено: исходный regression unmounts при активном touch; эта ветка защищена и проверяется естественным release. Static pending-runtime verdict не заявлялся как production-ready; итоговые runtime evidence проверены lead отдельно.

Lead просмотрел Family screenshots шести themes (`lead/family-contrast-{mint,rose,sky,lavender,apricot,sand}.png`), canonical photo-empty320px и representative Linux images. Все 18 изменённых Win32 poster PNG просмотрены по expected/actual парам; изменения — одна raster row и native-controls edge/glyph rendering при той же композиции. Общие tolerances не менялись. 18 Linux baselines сняты настоящими Chromium/WebKit и проверены повторным no-update run. Diagnostic candidate run не считается acceptance. Frozen canonical HTML/hash не менялся.

Linux final R3: Debian13.6 trixie amd64, PW1.62.1, Chromium151.0.7922.34, WebKit26.5, Node20.19.2, Bun1.4.0, FFmpeg7.1.5. Image `ourmemories-playwright-runner:20261008`, imageID `sha256:665aa72749db62a44672543c84d15b1115c2d1138c00f50f789d910d28274e95`. Lead сверил stdout/exit marker/passed `.last-run.json` и шесть traces. Current-source manifest589:588 SHA совпадают с host, дополнительный служебный placeholder отсутствует; stale inputs не осталось. Fingerprint `deefd610dcbb66e72dccb4d54f6d421e5a720d8f6225bdb99337899b4fd2617d`; all18Linux PNG unchanged (`lead/linux-source-fingerprint-comparison-final-r2.json`). Runtime metadata `../linux-poster-repeat-20261008/artifacts/runtime-r3-final.stdout.log`. Official OS deps installed только в owned ephemeral container; libraries missing0. Root подтвердил удаление exact R3 container, cache/evidence сохранены. Debian run не сертифицирует unpublished Ubuntu CI.

Свежий Docker image `memoly-backend:preprod-owned-smoke-20261008`, imageID/manifest-list digest `sha256:659953be26e2f7fb2683a4e249d68449ae95d627c064fd5c386e21fa4dfcf20b`: linux/amd64, USER bun, Sharp0.35.5 реально декодировал synthetic2×2PNG95B. Foreign sentinels preserved=true; own UUID service/volume/network отсутствуют после cleanup. Это локальный verification artifact, без staging promotion или опубликованного release digest. При финальном read-only cleanup recheck Docker Desktop API был недоступен (daemon не запущен); исторический exit0 smoke и stop/remove evidence сохранены, Docker заново не запускался.

## Остаточные ограничения и rollback

Для production остаются новый GitHub Verify на опубликованном SHA, staging promotion того же digest, real-device Telegram/MAX/PWA smoke, restore drill и нагрузочная приёмка. В предыдущем Windows default-r3 один worker аварийно завершился с code3221226505 (125/1, exit1). Соседние cases98/99 затем прошли каждый по3 (6/0, exit0); причина native crash не установлена. Исходники и runner config ради этого не менялись, неуспешный run сохранён в evidence history. Poster-r6 также остался без финального summary/exit marker после WebKit failures (expected0/receivedundefined); причина не установлена, trace сохранён. Повтор poster-r7 выполнен на неизменных исходниках. Known-advisory audit не исключает неизвестные уязвимости. Cold font cache не pin неизменяемой upstream revision; production remote fonts/performance требуют внешней проверки. Fixture credential/error semantics не полностью повторяют production HttpClient.

Schema/contracts/migrations не менялись. Rollback кода — обычный обратный commit; database restore не выполнялся. Новая задача и production deploy не запускались.

Автоматическая проверка разрешений отклонила recursive delete exact synthetic context `C:/Users/Alexandr/AppData/Local/Temp/OurMemoriesDockerCacheProbe-20261008` с причиной `blocked by policy`. Каталог оставлен, запрет не обходился. Удалены только собственные разрешённые Docker resources; unrelated Bun PID48320 не трогался.

Allowed paths: backend jobs/caption/avatar/race tests/Docker; dependency manifests/lock/vendor CSS; verify/release planner/gate/tests/docs; FeedPage/touch guard/scoped Family CSS; E2E specs/helpers/fixtures/configs/platform references; website dependency/CSS import. Точный список активного diff следует ниже; `webapp/src/main.tsx` имеет пустой actual diff и в список реализации не входит.


## Активные changed paths (102)

```text
.github/workflows/selectel-release.yml
.github/workflows/verify.yml
backend/Dockerfile
backend/package.json
backend/scripts/docker-smoke.mjs
backend/scripts/docker-smoke.test.mjs
backend/src/jobs.ts
backend/src/modules/media/infrastructure/reservation-race.integration.test.ts
backend/src/modules/telegram/infrastructure/caption-race.integration.test.ts
backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts
backend/src/race-regression-fixtures.ts
backend/src/storage/normalize-avatar-image.test.ts
backend/src/storage/normalize-avatar-image.ts
bun.lock
deploy/selectel/README.md
docs/DEPLOYMENT.md
docs/mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md
docs/reports/preprod-audit-20261007-plan.md
docs/reports/preprod-audit-20261007.md
docs/reports/preprod-fix-20261008-evidence-history.md
docs/reports/preprod-fix-20261008-plan.md
docs/reports/preprod-fix-20261008.md
package.json
scripts/require-release-verification.mjs
scripts/verify-plan.mjs
tests/require-release-verification.test.ts
tests/verify-plan.test.ts
vendor/shadcn/LICENSE
vendor/shadcn/README.md
vendor/shadcn/tailwind.css
verification-map.json
webapp/e2e/adult-avatar-harness.tsx
webapp/e2e/adult-avatar.spec.ts
webapp/e2e/agent-k-accessibility.spec.ts
webapp/e2e/child-avatar.spec.ts
webapp/e2e/feed.spec.ts
webapp/e2e/global-setup.ts
webapp/e2e/helpers/inter-font-cache.ts
webapp/e2e/helpers/test.ts
webapp/e2e/private-video-poster.fixture.tsx
webapp/e2e/private-video-poster.playwright.config.ts
webapp/e2e/private-video-poster.spec.ts
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-win32.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-linux.png
webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-win32.png
webapp/e2e/private-video-poster.vite.config.ts
webapp/e2e/specs/family.spec.ts
webapp/e2e/specs/missing-visual-matrix.spec.ts
webapp/e2e/specs/mm1-mixed-composer.spec.ts
webapp/e2e/specs/welcome.spec.ts
webapp/e2e/warm-navigation-cache-regression.spec.ts
webapp/e2e/warm-navigation-cache.fixture.tsx
webapp/e2e/warm-navigation-cache.playwright.config.ts
webapp/package.json
webapp/playwright.config.ts
webapp/README.md
webapp/src/features/feed/audio-playback.ts
webapp/src/features/feed/FeedPage.tsx
webapp/src/features/feed/presentation/MemoryCardPresentation.tsx
webapp/src/features/feed/presentation/retargeted-touch-click-guard.ts
webapp/src/features/memoly-ui/family-management.css
webapp/src/features/memoly-ui/memoly-ui.css
webapp/src/index.css
webapp/tests/playback.test.tsx
webapp/tests/retargeted-touch-click-guard.test.ts
webapp/tsconfig.e2e.json
webapp/vite.config.ts
website/package.json
website/src/styles/global.css
```
