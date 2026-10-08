# FIX-PREPROD-2026-10-08 — исправления после аудита

Дата: 2026-10-08. Статус: IN_PROGRESS — исправления реализованы, заключительные browser runs продолжаются. Владелец разрешил исправление контраста и явно принял запрет page zoom; решения зафиксированы в [accessibility decision](../mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md). Linux poster suite: 6/6 до последних test-harness изменений, exit 0.

Lead: GPT-6. Первоначальным рабочим агентам назначался GPT-6 Luna High; новые role-based worker/scout используют фиксированный GPT-6 Luna Medium, независимые reviewers — GPT-6 Luna High. Точный runtime identifier инструменты не предоставляют. Назначение владельца: «Тогда исправляй» после [аудита](preprod-audit-20261007.md).

- Branch: `fix/preprod-20261008`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007`.
- Base/head до commit: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`.
- PR: не опубликовано; merge/deploy не выполнялись.
- Allowed paths: найденные backend defects и их tests; workspace manifests/lock и vendored CSS; verify/release tooling/workflows/docs; E2E configs/specs/synthetic fixtures; smoke harness и отчёты; Family contrast foregrounds по прямому решению владельца; FeedPage carousel viewer lifecycle по подтверждённому case24. Schema/migrations и публичные contracts не менялись.

## Исправления

1. Avatar validation проверяет supported raster signature до Sharp. SVG под MIME PNG не попадает в decoder; Sharp обновлён до 0.35.5. Остальные известные advisories устранены совместимыми обновлениями. Уязвимый shadcn CLI удалён; точный CSS 4.16.1 и MIT notice сохранены в vendor, existing React components остаются локальными. Suppressions не добавлялись.
2. Cleanup получает family lock перед reservation и условно освобождает только актуальную expired/unfinalized/unreleased запись. Caption consume блокирует и перечитывает request после ACL locks: committed cancellation не изменяет memory; одновременные replies не увеличивают version дважды.
3. Release workflow требует успешный последний Verify run и единственный successful verify-required для exact current-main SHA; отсутствие/ошибки/pending/API timeout закрывают gate. CLI реально работает в Node. FULL и PR impact планы запускают статически назначенные проверки; исправлены три дополнительных P2 из независимого review.
4. Main protection реально включена после успешного baseline Verify run [37723627116](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37723627116). Подтверждены strict verify-required, PR requirement, admins enforcement, resolved conversations, linear history, запрет force-push/delete. Required approvals=0 при единственном владельце; отдельное техническое review не подменяется self-approval. Auto-merge выключен. Новые локальные CI изменения ещё не проверялись на GitHub.
5. E2E исправляет stale selectors, publication fixtures, synthetic owner reuse и Telegram Back mock. Temporary welcome runtime сохраняется согласно принятому owner commit; тесты явно проходят Continue и проверяют claim semantics. Poster и warm-cache запускаются отдельными обязательными companion harnesses; audit artifacts исключаются из discovery.
6. Photo caption в 320 px сохраняет обязательный 16 px font-size по design.md:128; более мелкий canonical reference имеет иной line wrap. Конкретный height delta фиксируется явно, проверяются font size, natural fit, separation/containment; общие tolerances не расширяются.
7. Dockerfile устанавливает frozen dependencies после копирования root и четырёх текущих workspace manifests; исходники копируются после install. Source/test/doc edits больше не должны инвалидировать dependency layers. Bun1.4.0, filters/network limits, production USER/NODE_ENV, FFmpeg/CA сохраняются. Smoke harness отключает реальные Telegram calls и проверяет production browser-link challenge/verifier-cookie/status через тестовую БД.
8. По прямому выбору владельца foreground Family role badges (включая viewer), info-card copy/label и MAX status/error/action использует существующий `--memory-text` #302a2e. Layout/background/fonts/assets и frozen canonical HTML сохраняются; новые цвета записаны отдельно. Прежний contrast whitelist удалён. Запрет page zoom остаётся по отдельному прямому выбору владельца; только raw axe meta-viewport findings принимаются как документированное ограничение, остальные findings должны быть нулевыми. Это не заявление полного WCAG соответствия.

## Выполненные проверки

| Команда / профиль | Tests pass/fail | Exit | Evidence |
|---|---:|---:|---|
| backend unit | 640 / 0 | 0 | `.artifacts/fix/lead/backend-unit.log` |
| backend integration, полный повтор | 369 / 0, 32 summaries | 0 | `.artifacts/fix/lead/backend-integration-final.log` |
| contracts | 56 / 0 | 0 | `.artifacts/fix/lead/contracts.log` |
| webapp unit | 468 / 0 | 0 | `.artifacts/fix/lead/webapp-unit.log` |
| webapp unit после production contrast overrides | 468 / 0 | 0 | `.artifacts/fix/lead/webapp-unit-post-contrast.log` |
| webapp unit после production PhotoSwipe lifecycle fix | 468 / 0 | 0 | `.artifacts/fix/lead/webapp-unit-post-viewer.log` |
| infrastructure | 124 / 0 | 0 | `.artifacts/fix/lead/infra.log` |
| website unit | 7 / 0 | 0 | `.artifacts/fix/lead/website-unit.log` |
| builds и artifact contracts | 3 / 0 | 0 | `.artifacts/fix/lead/build-contracts.log` |
| verification tools | 26 / 0 | 0 | `.artifacts/fix/lead/verification-tools-final.log` |
| live local S3 | 16 / 0 | 0 | `.artifacts/fix/lead/s3-live.log` |
| заключительный root typecheck, включая tracked strict E2E gate | все workspaces, 0 errors | 0 | `.artifacts/fix/lead/typecheck-final.log` (Astro: один existing deprecation hint) |
| lint; architecture (805 files); template до последних E2E corrections | выполнены | 0 | lead logs; заключительные повторы ожидаются |
| frozen install; dependency audit | известные advisories: 0 | 0 | lead command outputs |
| focused welcome E2E | 3 / 0 | 0 | `.artifacts/fix/e2e/logs/welcome-focused.log` |
| Agent K после owner decisions + contrast fixes | 1 / 0, 42 unique scans | 0 | `.artifacts/fix/e2e/logs/agent-k-r1.log`; lead `.artifacts/fix/lead/accessibility-final-summary.json` |
| Docker smoke configuration contract | 1 / 0 | 0 | lead + independent review outputs |
| Полный default E2E, диагностический прогон | 60 pass / 11 fail / 55 did not run | 1 | `.artifacts/fix/e2e/logs/full-release.log` |
| Полный default E2E, второй диагностический прогон | 58 pass / 8 fail / 60 did not run | 1 | `.artifacts/fix/e2e/logs/default-full.log` |
| Полный default E2E r9 | 73 pass / 5 fail / 48 did not run | 1 | `.artifacts/fix/e2e/logs/default-full-r9.log` |
| Linux video poster, финальный no-update повтор | 6 / 0 | 0 | `.artifacts/private-video-poster-linux-results/.last-run.json` и шесть `trace.zip`; stdout только в tool transcript |
| MM-1 mixed media, финальный repeated focused r11 | 3 / 0 | 0 | `.artifacts/fix/e2e/logs/mm1-repeat-r11.log` |
| Video Viewer loading/error, focused r11 | 2 / 0 | 0 | `.artifacts/fix/e2e/logs/matrix-viewer-r11.log` |
| Feed theme reload six themes × three widths, r13 | 1 / 0 | 0 | `.artifacts/fix/e2e/logs/feed-theme-r13.log` |
| Feed unread journey, persisted-state prerequisite r15 | 1 / 0 | 0 | `.artifacts/fix/e2e/logs/feed-unread-r15.log` |
| Family warm reload + cold list Retry, targeted r8 | 1 / 0 | 0 | `.artifacts/fix/e2e/logs/focused-family-r8.log` |
| Production Linux image browser-link probe | health/start/status: 200; pending | 0 | worker probe evidence; не заменяет fresh full smoke |
| Fresh Docker build + production runtime/DB smoke | frozen install/Prisma/health/browser-link passed | 0 | `.artifacts/fix/lead/docker-smoke-manifest-cache.log` |
| Node exact-SHA gate, GitHub read-only API | current accepted base Verify найден | 0 | `.artifacts/fix/lead/live-node-readonly-gate.log` |

Все пути evidence в таблице относительны `webapp/e2e/`; отдельные ранние worker logs находятся в ignored root `.artifacts`. Это синтетические локальные fixtures, приватные артефакты в Git не добавляются.

Default discovery содержит 126 cases. Диагностические прогоны выявили устаревшие bootstrap/reload assumptions, неполные publication fixtures и MM-1 selectors. Did not run — cascade внутри serial groups, а не успешные проверки. Итоговый default126 и Windows companion6+1 ещё предстоит завершить последовательно с CLI output overrides; это компоненты release script, а не заявление об успешном запуске буквальной composed-команды.

Targeted исправления подтверждены: unread geometry, invite onboarding, Feed header, full-member permissions и PhotoEmpty matrix прошли в r2 (общий 5 pass/2 fail); оставшиеся Family и MM-1 проверены после конкретных последующих corrections. MM-1 дважды прошёл publication/order, add/remove reactions с успешными PUT responses, carousel/viewer/video playback: повторное меню открывается после mutation completion и возврата фокуса; decoded dimensions проверяются после explicit playback для `preload="none"`, no-autoplay/privacy checks сохранены. Family r8 прошёл exact persisted Family selection, возврат к Hub/null selection, warm cached-home warning/card и cold 503→Retry→Feed с exact family ID. Cold phase использует новый реальный browser context; provisional diagnostic cache mutation удалена. Неактуальные Feed-only/nonexistent labels заменены existing working child-header helper, без production changes.

Unmasked default r9: `bun run e2e -- --output <absolute webapp/e2e/.artifacts/fix/e2e/default-r9-results>` из `webapp`; log `.artifacts/fix/e2e/logs/default-full-r9.log`, discovery 126. Tracked specs/configs во время него не редактировались.

R9 завершён за 15.6 min: 73 pass/5 fail/48 did not run, exit 1. Помимо Agent K, Feed nav и PWA cached-screen ожидания, VideoViewer loading fixture не перехватывал новый readiness GET (реальный disabled-MAX backend возвращал 404), поэтому pending playback POST не начинался. Shared schema подтверждает ready/recheckable=false; назначен exact synthetic-reference mock readiness без изменения production. Photo/Note/Voice/Video Composer (6 matrix cases) прошли; error viewer был skipped. Все Family scenarios кроме старого PWA-reload Hub ожидания прошли, включая warm/cold retry, ACL, profile editing, crop/CAS. MM-1 в полном прогоне снова обнаружил timing failure и не считается надёжно зелёным по двум предыдущим targeted успехам.

Independent trace review MM-1 подтвердил test-induced scroll: `call@138` Locator.focus содержал только selector/strict (preventScroll отсутствует), scrollTop стал 13; document scroll listener закрывает picker по product contract. Следующий visibility check `call@144` прошёл по Radix portal уже с data-state=closed во время exit animation. Lead лично распаковал `0-trace.trace` и проверил эти call params, scroll marker и closing snapshot. Production reactionContext bug не подтверждён. Назначены проверка настоящего return focus без redundant focus и gate actual data-state=open; затем repeated targeted runtime и полные затронутые serial groups.

После correction MM-1 r11 прошёл в трёх повторах: 3/0, exit 0, 49.4 sec; lead прочитал фактический итог лога. Video Viewer r11: 2/0, exit 0, 1.3 min. Помимо exact-reference readiness mock, Details открываются только после получения video DTO: fixture body/kind/viewer проверяются до Actions→Подробнее, иначе ранее Details захватывал сохранённую Note из кеша. Проверки actual held playback POST/loading и actual 503/Retry остаются в Details. Lead просмотрел diff и оба результата.

Feed r11 и Family theme r11 недействительны для product acceptance: worker параллельно запустил разные Playwright invocations с общей тестовой БД, один teardown остановил БД второго прогона. Matrix r11 и MM-1 repeats завершились до этой коллизии. Все последующие runners запускаются строго по одному. Изолированный Feed r12: 13 pass/1 fail/41 did not run, exit 1, 2.9 min. Case14 theme-reload ожидал Hub после восстановления Family; actual error-context лично прочитан lead, назначено сохранение initial Hub selection и проверка restored Family/theme перед явным переходом в Feed. Discovery этого spec: 55 cases, а не 56.

Theme r13 прошёл 1/0, exit0, 1.1 min: после reload проверены actual Family surface, persisted screen/family ID и theme; затем existing geometry/carousel/focus для всех шести themes × трёх widths. Feed r14: 1 pass/1 fail/53 did not run, exit1; unread case ожидал restored Feed до завершения IndexedDB persistence. Перед второй reload добавлен readonly poll existing persistent-ui state `{screen:'feed', selectedFamilyId}`. Focused r15 прошёл полный unread journey 1/0, exit0, 39.5 sec. Lead прочитал actual diff/result, состояние в тесте не записывается, unread assertions не ослаблены. Это установление prerequisite теста на восстановление; моментальная сохранность любого UI transition при незавершённой записи отдельно не заявляется.

Lead lint после E2E cold-context correction выявил единственный `prefer-const` для `failWarmHome`. После семантически неизменного let→const fix повтор прошёл exit 0 (`.artifacts/fix/lead/lint-post-e2e-queue.log`). Architecture805/template/diff checks также прошли. Последующие E2E corrections ещё требуют заключительного lint.

R9 case42 выявил ambiguous global navigation locator: после посещения Family обе surfaces остаются mounted, Family скрыта; `.locator('[data-testid="bottom-navigation"]').evaluate` разрешается в два элемента. Остальные 47 cases serial Feed group пропущены. Это test harness defect; после r9 назначено scope по active Feed с сохранением color/icon/mask assertions, полный 56-case Feed повтор до очередного default126. Текущий r9 не удовлетворяет требованию полного Feed покрытия.

Один focused retry завершился на webServer setup, не начав tests: orphan `.prisma-generate.lock` 0 bytes. Lead проверил process inventory: ни одного generator/process этого exact worktree; единственный unrelated Bun не трогался. Worker удалил только этот exact lock по lead разрешению, последующий setup прошёл. Этот setup exit 1 не записан как падение product tests.

Windows poster: lead визуально проверил четыре actual/expected пары и разрешил только landscape-preview и mixed-portrait-preview для Chromium/WebKit (четыре PNG, изменение высоты на 1 px). Остальные исходные Windows PNG сохранены. Linux: 18 новых PNG сняты настоящими Linux browsers. Первый no-update повтор 5/6 выявил один пиксель ширины WebKit mixed-portrait; focused повтор воспроизвёл его, проверены CSS width/позиция после carousel transition, обновлены только два затронутых новых Linux PNG. Финальный no-update повтор: 6/6, exit 0. Lead прочитал persisted passed/no-failed result и проверил наличие шести traces, просмотрел четыре representative screenshots. Предыдущие Linux outputs были заменены в общем output directory, отдельные stdout logs не сохранены; ранние результаты существуют в tool transcript.

Linux runner: Debian 13 trixie amd64, Node 20.19.2, Playwright 1.62.1, Chromium 151.0.7922.34 rev1234, WebKit 26.5 rev2336, FFmpeg rev1011; runner digest `sha256:665aa72749db62a44672543c84d15b1115c2d1138c00f50f789d910d28274e95`. Финальная команда: `docker exec linux-poster-runner-20261008 node /workspace/node_modules/@playwright/test/cli.js test -c /workspace/webapp/e2e/.artifacts/private-video-poster-linux.config.ts --workers=1`. Это локальный Linux повтор, не фактически выполненный Ubuntu GitHub job. Собственный runner container удалён, Vite остановлен перед передачей Windows worker.

Ранний fresh Docker smoke остановлен после 15 min без прогресса frozen installs и не считается pass. На более раннем образе отдельно проверен DB-backed browser-link API probe; этот probe не подменяет последующую успешную полную пересборку.

Последующий fresh full smoke с manifest-only dependency layers прошёл exit0. Оба cold installs завершились за 729.5/758.3 sec, Prisma/runtime/browser-link прошли. Проверенный image `memoly-backend:preprod-cache-20261008`, digest `sha256:12e011b973aa3e834b2a3dfa8a4bfd31b0325c89be56ed79a469e8a5a9245ff3`; lead подтвердил image identity, USER=bun и linux/amd64 и просмотрел полный итоговый лог. Owned DB/container/data volume очищены harness. Registry publication и production deploy не выполнялись.

Source-only cache proof: temporary build context с добавленным synthetic `backend/cache-copy-probe.txt`, manifests/lock без изменений; build-target exit0/26.8s, full image exit0/3.45s, оба install RUN=CACHED, post-install source COPY invalidated. Lead просмотрел логи `docker-cache-source-change-probe.log` и `docker-cache-source-change-full-build.log`; independent reviewer подтвердил cache/smoke milestones. Логи BuildKit не записывают внешний process exit code или содержимое temp context: эти детали сообщены worker; lead не представляет их как отдельный повторный запуск. Linux Sharp0.35.5 probe на проверенном образе: synthetic PNG → 2×2 PNG, 95 bytes. Удаление `C:/Users/Alexandr/AppData/Local/Temp/OurMemoriesDockerCacheProbe-20261008` отклонено execution policy (`blocked by policy`) даже после проверки точного resolved target и отсутствия reparse points; synthetic context оставлен, обходов запрета не выполнялось. Cache-proof image tags и owned smoke Docker resources очищены.

Заключительный lead `bun audit`: exit0, 935 packages, «No vulnerabilities found», `.artifacts/fix/lead/dependency-audit-final.log`. Это аудит известных advisories, не обещание отсутствия всех возможных уязвимостей.

Прежний production Agent K whitelist contrast violations (`.family-role`, `.family-info-card > div`, `.family-info-card > div > strong`) удалён. Старый packet фиксировал contrast 2.87–3.86 при требовании 4.5:1 и требовал owner A/B decision. 2026-10-08 владелец явно выбрал исправить контраст ≥4.5:1, сохранить frozen reference как историю и отдельно зафиксировать новые цвета. Этот выбор и новые foreground/background ratios записаны в [AGENT_K_ACCESSIBILITY_DECISION.md](../mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md). Actual 42-state acceptance прошла: 1/0, exit0, 1.4 min; lead самостоятельно разобрал log JSON, подтвердил 42 unique theme/state, contrast0, other-unapproved0, exact meta-viewport42/nodes42. Цвет роли viewer и обычного MAX loading/status copy также исправлен: это live ветви с прежними token-derived ratios <4.5, не новые contrast exceptions.

Повтор 42 состояний выявил ещё два actual contrast signatures во всех 18 Family/Settings/Theme scans: `.family-max-channel > div > button` (mint 2.27:1) и `p[role="alert"]` (mint 3.85:1). MAX выключен в synthetic E2E backend, route отсутствует; настоящий status hook получает 404 и показывает load-error/retry. Это legitimate rendered error-state UI, его не скрывали и не подменяли fake success. Source: `FamilyPresentation.tsx:116`, `family-management.css:59`, `useFamilyMaxChannelStatus.ts`. При выборе AA эти два scoped foregrounds также требуют исправления и проверки. Старый packet и три whitelist signatures не описывают полное текущее состояние.

Lead отдельно разобрал 42 JSON scan records из `focused-corrections.log`: шесть themes × семь states (Feed, Family, Member, Add, Settings, Theme, Family form); rule IDs только `color-contrast` и `meta-viewport`, 90 contrast nodes. Это actual текущая evidence, а не старые 72 nodes из decision packet.

Масштабирование: принятый commit `df2972d` намеренно запрещает page zoom через viewport, global gesture/wheel listeners и root CSS; unit tests требуют этот контракт. 2026-10-08 владелец явно выбрал сохранить запрет и принять ограничение accessibility. Production zoom policy и PhotoSwipe zoom не меняются. Agent K запускает все axe rules, сохраняет raw findings в 42 состояниях, проверяет restricted viewport и принимает только exact `meta-viewport` rule с указанным owner decision. Контраст и остальные правила не исключаются. Passing означает zero unapproved violations с принятой zoom limitation.

RED/GREEN: три DB regressions воспроизводили исходные гонки, затем прошли; isolated child avatar test подтверждает SharpCalls=0 и падал на base. Первый full integration прерван exit255: Bun завис до SQL в native Argon2, Postgres idle; targeted/users-file/full повтор прошли. Ранние Docker smoke выявили неверные harness Telegram configuration и legacy endpoint, исправленные до успешного fresh smoke. Первый E2E discovery ошибочно включал Bun audit test из ignored artifacts; discovery теперь исключает такие файлы и companions.

Изолированный E2E TypeScript diagnostic exit 2 выявил существующие ошибки, часть из которых подтверждена в HEAD: Buffer/BlobPart, расширенные fixture types, payload type и старый DOM remove. Production webapp typecheck не включает E2E. Undefined imports/Prisma, внесённые текущим fixture fix, исправлены. После расширенной диагностики lead назначил ограниченные исправления типов тестов; до общего заключительного diagnostic типизация E2E не считается зелёной.

Lead расширил ignored strict diagnostic на tracked E2E и Playwright config TypeScript (`tsconfig-e2e-all.json`, initial log `.artifacts/fix/lead/e2e-tscheck-all-initial.log`, exit2). Затем добавлен tracked standalone `webapp/tsconfig.e2e.json`: включает TS/TSX specs/helpers/fixtures, configs, исключает `.artifacts`; existing webapp/root/CI typecheck вызывает strict noEmit после `tsc -b`, production build script не меняется. RootDir/composite не вводились. Tracked initial diagnostic лично запущен lead: 59 ошибок в десяти E2E файлах (`.artifacts/fix/lead/e2e-tscheck-tracked-initial.log`, exit2), включая ранее не проверявшиеся TSX fixtures. Ограниченные type corrections реализованы без suppressions/any/ослабления приёмки. Lead actual root typecheck всех workspaces, включая strict E2E gate, прошёл exit0; subsequent E2E corrections потребуют последнего повтора.

Lead strict noEmit diagnostic: `bunx tsc --noEmit --strict -p webapp/e2e/.artifacts/fix/e2e/tsconfig-e2e.json`, exit 2. Новый неверный option `Locator.focus({preventScroll:true})` устранён: redundant refocus удалён, тест проверяет настоящий возврат фокуса и actual open portal. Lead post-queue diagnostic подтверждает отсутствие новой ошибки focus (`.artifacts/fix/lead/e2e-tscheck-post-queue.log`); оставшиеся диагностические ошибки требуют отдельной оценки.

## Review, визуальный контроль и ограничения

Первый independent read-only review: три P2 по CI completeness, исправлены назначенным worker. Fresh independent review всего active code diff не выявил подтверждённых P0/P1/P2; reviewer дополнительно выполнил 34 связанных tests (gate/planner/avatar/smoke config), 0 fail. Reviewer не повторял PostgreSQL/E2E/Docker: эти результаты подтверждает отдельная lead/worker evidence. Последующие E2E harness corrections проходят узкую повторную проверку; полный browser/runtime итог будет добавлен после завершения.

Узкое independent review E2E подтвердило P2: full-member scenario дважды вызывал Continue после reload (прямой вызов и вызов внутри helper). Назначенный worker удалил дублирование; focused runtime и последующий r9 Family scenario прошли. Reviewer не запускал browsers/servers параллельно с единственным владельцем E2E caches. Default/companion output paths восстановлены; task-specific evidence задаётся CLI.

Статический narrow recheck тех же исправлений подтвердил устранение P2 и не выявил новых P0/P1/P2: optional Continue ждёт splash/restored surface; reload test сохраняет assertions Family screen/selected family и отдельно проверяет list retry; MM-1 обращается к focusable article и actual selected-heart label, сохраняя add/remove; seed использует exact bytes. Review не подменяет pending runtime acceptance.

Node storage fixture: 70-byte PNG Buffer использовал pooled 8192-byte backing ArrayBuffer, и `body.slice().buffer` создавал oversized Blob. Worker передаёт точную копию `Uint8Array`, reviewer подтвердил размеры isolated Node probe. Текущий production upload route формирует exact-sized plain Uint8Array; production Buffer caller не найден. Это подтверждённый Node E2E fixture defect, не доказанная поломка production storage. Возможный будущий direct Buffer caller остаётся API edge, записан без расширения текущей реализации.

Fresh narrow independent review постоянного E2E typing gate и дополнительных TSX/avatar/companion fixes: подтверждённых P0/P1/P2 нет. Reviewer проверил actual diff, strict/noEmit/include/exclude, `satisfies` context/HostBridge, отсутствие type suppressions, нормализацию fixture body/rawBody по HttpClient; assigned diff check exit0. Runtime acceptance не заявлялась. Fixture HTTP errors обрабатываются упрощённо; Fetch credentials default same-origin, production HttpClient include. Все эти fixture requests same-origin, это ограничение эквивалентности адаптера, не текущий P2. Полные повторные browser checks остаются обязательны.

Fresh narrow independent review нового production CSS/AgentK waiver/dated decision record: подтверждённых P0/P1/P2 нет, static only. Raw 42-state runtime acceptance отдельно проверил lead. Accepted page-zoom restriction остаётся accessibility limitation; отсутствие unapproved axe findings не означает полного WCAG соответствия.

Lead просмотрел actual/canonical photo-empty screenshots при 320 px; evidence сохранено в ignored artifacts. Canonical source/hash не изменялся. Не выполнялись реальные Telegram/MAX calls, отправка приглашений посторонним, production migrations/deletes или deploy. Успешные локальные проверки не заменяют staging promotion по digest, real-device smoke, restore drill и нагрузочную приёмку; эти внешние acceptance gaps остаются предметом отдельного release назначения.

## Дополнительный подтверждённый P2: PhotoSwipe при уходе из Feed

Case24 обнаружил production lifecycle defect: Family уже активна, но двухфотографический PhotoSwipe album остаётся открыт, поскольку его отдельный carousel controller закрывался только при unmount; warm Feed остаётся mounted. Read-only scout подтвердил ownership/event mismatch. Bounded worker изменил только `webapp/src/features/feed/FeedPage.tsx`: существующий controller abort на memoly:feed-inactive, matching listener removal и прежний abort при unmount. Lead просмотрел actual diff.

RED: `feed-22-55-r1.log`, case24 fail (2 pass, 1 fail, 31 did not run). Первый повтор r2 остановлен environmental Vite exit9 и не считается acceptance. GREEN: `feed-photoswipe-cleanup-r3.log`, тот же case24 без ослабления assertions, 1 pass / 0 fail / exit0; .pswp=0, handlers=0, 7 created URLs = 7 released, focus/scroll/Telegram Back/browser Back сохранены. Lead отдельно запустил web unit: 468 pass / 0 fail / exit0, `lead/webapp-unit-post-viewer.log`. Новый delta ещё требует fresh independent review и общего E2E acceptance.

E2E case21 выявил remote Inter WOFF2 waits до 40s внутри screenshot fonts.ready. Lead разрешил test-only ignored cache точных upstream CSS/WOFF2 с обычным TLS, URL/content/size/deadline и SHA/length checks, OFL notice и atomic manifest; production font и screenshot readiness остаются. Итоговый runtime результат этой коррекции пока не подтверждён. Case25 после настоящего старта private video прошёл focused 1/0 exit0 (`feed-mixed-carousel-r3.log`); case26 trace подтвердил несогласованность synthetic MAX list и real private detail DTO. Для case26 разрешён matching GET fixture только конкретного memory ID, остальные detail endpoints остаются реальными; metadata/playback/provider/privacy assertions сохраняются.

Последующие actual проверки lead: полный ESLint exit0 (`lead/lint-final-r1.log`), architecture 805 source files exit0 (`lead/architecture-final-r1.log`), template exit0 (`lead/template-final-r1.log`). Lead independently вызвал loadVerifiedInterFontCache: exit0, 40 resources / 38 WOFF2 / 4,914,456 font bytes, CSS SHA256 46d01c7807f64a24c1b2853b756ef15f3a2facdf4a9f066eaf5d39c0c9935441, OFL 4,380 bytes. Original case21 90s budget прошёл 1/0 exit0, test46.4s (`e2e/feed-add-fontcache-r1.log`), без bypass fonts.ready или fallback font.

Fresh independent narrow review latest lifecycle/font-cache/Feed fixture delta: подтверждённых P0/P1/P2 нет, scoped diffcheck0, static only. Lead не принимает reviewer production_ready label: общий runtime acceptance и внешний release evidence остаются обязательными. Cold cache принимает текущие upstream CSS/WOFF2 и фиксирует их хеши; это same-run exact-byte determinism, а не pin неизменяемой upstream revision между независимыми cold runs. Production использует тот же remote Inter; performance/device/staging ограничения сохраняются.

MAX case26: exact-ID detail fixture harmonization сохраняет genuine DTO и заменяет только тот же video slot, что в list. r2 ещё RED: readiness=ready при preload=none не означает decoded metadata до user action. r3 GREEN1/0 exit0, test22.8s (`e2e/feed-max-mixed-r3.log`): paused/no content до явного Смотреть видео, затем настоящий decode320×180/errornull, stablecard/slide/provider checks сохранены. Case27 GREEN1/0 exit0, test34.2s (`e2e/feed-max-poster-r2.log`): custom controls processing contract, no available play/no autoplay/NaN duration/zero content и прежние poster navigation/reload/card identity checks. Это исправления устаревших тестовых ожиданий, production video policy не меняется.

Fresh independent review всего active diff: подтверждённых unresolved P0/P1/P2 нет, diffcheck0. Reviewer не запускал общий runtime, его pending-verification verdict не считается отдельным code finding; заключительные E2E/build проверки остаются обязанностью lead. Lead readonly strict E2E noEmit после fontcache прошёл exit0 (`lead/e2e-typecheck-fontcache-r1.log`).

Последний lead repeat до runtime gesture acceptance: webapp 470 pass / 0 fail / 3258 expects / 74 files / exit0 (`lead/webapp-unit-post-gesture-r1.log`); lint exit0 (`lead/lint-final-r2.log`); architecture806 files exit0 (`lead/architecture-final-r2.log`); template exit0 (`lead/template-final-r2.log`); diffcheck0 (`lead/diff-check-r2.log`). Дополнительные 2 guard unit cases не доказывают browser acceptance. Narrow reviewer исправил реальный пробел проверки keyboard/off-coordinate while released=true; focused2/0 11expects. Case52 initial fix RED1fail/exit1 (`e2e/feed-52-ghost-fix-r1.log`): naturalrelease still selectsHubcard. Production amendment отклонён lead до causal evidence; familyHub earlyreturn unmountsFeed, warmhiddenFeed применяется толькоFamilytab. Temporary main.tsx hook отсутствует (actual diff empty).

Lead isolated event-boundary probe (`lead/guard-task-boundary-probe.ts/.log`, exit0) personally confirms: after ownedpointerup then10ms next-task, initial0ms guard blocked=false, current900ms guard blocked=true. This is a post-fix comparison probe, not a fabricated pre-implementation TDD RED. New unit3/0 13expects; expiry950ms, foreignrelease, keyboard/off-coordinate afterreleased=true/freshpointer/cancel/blur/explicitcleanup covered. Instrumented case52 diagnostic1/0 onlyestablishes order (guardregisteredatHub; pointerup; timer0; trustedcompatclick); wrapper may perturbtiming and isnotacceptance. Diagnostics removed; naturaluninstrumentedrepeat3pending.


## Сохранённый журнал перед финальным Windows batch r3

# FIX-PREPROD-2026-10-08 — исправления и приёмка

Дата: 2026-10-08. Статус: IN_PROGRESS. Основные product defects исправлены, включая voice-play cancellation; owned Docker smoke прошёл. Windows default-r2 RED получил bounded spec-only fixes с focused3+6 GREEN; итоговая E2E приёмка и новый Linux repeat на current voice source ещё не завершены. Публикация, merge и deploy не выполнялись.

Task ID: FIX-PREPROD-2026-10-08. Назначение владельца: глубокое code review, гонки, TDD/E2E и последующее «Тогда исправляй». Lead: GPT-6; первоначальные workers — GPT-6 Luna High, новые role-based worker/scout — GPT-6 Luna Medium, reviewers — GPT-6 Luna High. Точный runtime model identifier недоступен.

- Branch: `fix/preprod-20261008`.
- Worktree: `D:/codex/TG_OurMemoriesDevBot/OurMemoriesDevBot/.worktrees/preprod-audit-20261007`.
- Base/head до commit: `c5f289fb9d4d9f3d97206d3e7b2e823e69efaf2d`. Проверялся текущий dirty task diff поверх этого SHA.
- Origin: подтверждён канонический `alexdubaev/OurMemoriesDevBot`.
- PR / merge SHA: не опубликовано / не слито.
- Schema, migrations и публичные contracts: изменений нет.

## Результат

1. Avatar decoder допускает только поддерживаемые raster signatures; SVG под PNG MIME отсекается до Sharp. Sharp и уязвимые транзитивные зависимости обновлены совместимо. Уязвимый shadcn CLI удалён, его точный CSS и MIT notice сохранены в `vendor/shadcn/`. Suppressions не добавлялись.
2. Reservation cleanup блокирует family перед reservation и освобождает запись условно; проигравший concurrent cleanup не дублирует side effects. Caption consume блокирует и перечитывает request: committed cancellation не меняет memory, два ответа увеличивают version один раз. PostgreSQL barrier regressions сначала воспроизвели три падения, затем прошли.
3. Release gate требует successful последний trusted Verify и ровно один successful `verify-required` для точного актуального SHA main. Отсутствие, ошибка, pending, API timeout или более новый failed run закрывают gate. Node CLI и FULL/impact verification mapping исправлены; три P2 независимого ревью по полноте CI устранены.
4. PhotoSwipe album закрывается при `memoly:feed-inactive`, включая mounted warm Feed; handler удаляется при unmount. Case24 прошёл с нулём оставшихся viewer handlers и 7 созданными/7 освобождёнными object URLs.
5. Pending touch при уходе к списку семей больше не активирует новую карточку после отпускания. Временный capture guard сохраняет ownership до совместимого click, максимум 900 мс после pointerup; fresh pointer, cancel, blur/pagehide и обработанный click его снимают. Keyboard и посторонние координаты пропускаются. Case52 с естественным touchEnd прошёл три повтора без instrumentation, включая Hub/null persistence и закрытие picker после reload.
6. Foreground Family badges/info и MAX status/error/action заменён существующим `--memory-text` #302a2e по прямому решению владельца. Новые рассчитанные ratios >10.6:1, frozen reference сохранён. Из Agent K удалены прежние contrast исключения. Запрет page zoom оставлен по отдельному явному решению владельца; принимается только exact axe `meta-viewport`, остальные findings должны быть нулевыми. [Решения и цвета](../mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md).
7. E2E теперь согласован с принятыми welcome/persistence/private-video contracts: реальные UI gates, readonly persistence prerequisites, точные synthetic media bytes/DTOs, explicit playback при preload=none, actual hit targets и PUT payloads. Приёмка ghost click и PhotoSwipe проверяется глобально, её ожидания не ослаблены. Strict E2E/TSX typecheck включён в обычный typecheck. Test-only Inter cache проверяет точные upstream CSS/WOFF2, TLS, URL/content/size/deadline, SHA/length и OFL; production font не меняется.
8. Docker install слои зависят от manifests/lock, исходники копируются после frozen install. Production smoke использует synthetic DB/storage, отключает реальные Telegram calls и проверяет health/browser-link challenge/verifier-cookie/status.

Main protection реально включена после accepted baseline [Verify 37723627116](https://github.com/alexdubaev/OurMemoriesDevBot/actions/runs/37723627116): strict required `verify-required`, PR, admins enforcement, resolved conversations, linear history, запрет force push/delete; approvals=0 при единственном владельце, auto-merge выключен. Новые локальные CI изменения ещё не запускались на GitHub.

## Проверки

Успешные строки имеют exit0; failed и pending строки не считаются успехом. Evidence paths ниже относительно `webapp/e2e/.artifacts/fix/` и остаются ignored, синтетические материалы не публикуются.

| Проверка | Pass / fail | Evidence |
|---|---:|---|
| `bun run test:backend:unit` | 640 / 0 | `lead/backend-unit.log` |
| `bun run test:backend:integration` | 369 / 0, 32 summaries | `lead/backend-integration-final.log` |
| `bun run test:contracts` | 56 / 0 | `lead/contracts.log` |
| `bun run test:webapp`, финальный повтор | 471 / 0, 3260 expects, 74 files | `lead/webapp-unit-final.log` |
| `bun run test:infra` | 124 / 0 | `lead/infra-final.log` |
| `bun run test:website` | 7 / 0 | `lead/website-unit.log` |
| `bun run test:verification-tools` | 26 / 0 | `lead/verification-tools-final.log` |
| live local S3 | 16 / 0 | `lead/s3-live.log` |
| Docker smoke contract, включая resource ownership | 3 / 0, 20 expects | `lead/docker-smoke-unit-final-r3.log` |
| builds / artifact contracts | 3 / 0, финальные обе сборки | `lead/build-contracts-final.log` |
| root typecheck, включая strict E2E | все workspaces, 0 errors | `lead/typecheck-final-r2.log`; Astro150 files, existing verticalAlign deprecation hint |
| lint / architecture / template | 0 errors; 806 source files | `lead/lint-final-r5.log`, `lead/architecture-final-r3.log`, `lead/template-final-r3.log` |
| frozen install / audit | exit0; 935 packages, known advisories0 | `lead/dependency-audit-final.log` |
| Agent K | 1 / 0; 42 unique scans, contrast0, unapproved0, accepted viewport42 | `e2e/logs/agent-k-r1.log`, `lead/accessibility-final-summary.json` |
| PhotoSwipe lifecycle case24 | 1 / 0 | `e2e/logs/feed-photoswipe-cleanup-r3.log` |
| natural touch case52 repeat3 | 3 / 0 | `e2e/feed-52-natural-touch-r3.log` |
| intrinsic MAX ratio repeat3, после sync fix | 3 / 0, 1.2min | `e2e/max-ratio-repeat-final.log` |
| welcome spec, unchanged fresh context/budgets | 3 / 0, 55.8s | `e2e/welcome-final.log` |
| warm-cache repeat3, unchanged30s budget | 3 / 0, 1.1min | `e2e/warm-repeat-final.log` |
| Windows default release E2E, первый final run | 87 / 2, 37 did-not-run; exit1, повтор PENDING | `e2e/default-final.log`, 27.7min |
| Windows poster, диагностический run с неверным discovery | 8 / 4; exit1, 12 вместо6, не принят | `e2e/poster-final.log` |
| Windows poster, final no-update acceptance | 6 / 0, 1.4min; Chromium3 +WebKit3 | `e2e/poster-final-r5.log`, passed `.last-run.json` |
| Windows warm-cache, первый final run | 0 / 1; exit1, повтор PENDING | `e2e/warm-final.log` |
| Linux poster, current app/spec/inputs no-update | 6 / 0, 1.1min; exit0, six traces | `../linux-poster-repeat-20261008/artifacts/linux-poster-six-r2.stdout.log` |
| fresh Docker build / runtime / DB smoke | health/start/status200, pending; Prisma passed | `lead/docker-smoke-manifest-cache.log` |
| owned Docker smoke, first run | exit1: production tarball extraction failure; foreign sentinels preserved | `lead/docker-smoke-owned-final.log`, `lead/docker-smoke-owned-final-summary.json` |
| owned Docker smoke, frozen retry | exit0; freshbuild/runtime/DB flow; sentinels preserved | `lead/docker-smoke-owned-final-r2.log`, `lead/docker-smoke-owned-final-r2-summary.json` |

471 web unit включает три новых touch guard cases. Сумма последнего полного набора deterministic test executions — 1715, с учётом трёх build contracts и новых smoke ownership cases; это executions, а не число уникальных бизнес-сценариев. Focused/repeated E2E и independent-review checks считаются отдельно.

История диагностических full E2E: 60/11/55 did-not-run; 58/8/60; r9 73/5/48, все exit1. Они выявили реальные viewer/gesture дефекты и устаревшие test fixtures; skipped/did-not-run не считается зелёным. MM-1 repeat3, 8-state viewer/composer matrix и Feed55 требуют итогового общего прогона даже после focused успехов. Компоненты release script выполняются строго последовательно одним browser owner; ранее параллельные runs с общей DB были признаны недействительными.

Последний default87/2/37 выявил test synchronization gap: MAX ratio case ожидал src только первой карточки до проверки точного общего счётчика3. Теперь каждая карточка ждёт собственный exact src, readiness, preload=none и paused; исходные счётчики/load/network assertions сохранены. Второй failure — второй fresh-context welcome navigation, до claim/application assertions. Warm-cache также остановился на начальном page.goto; trace показывает незавершённые Vite module requests. Под Vite root находились85,600 ignored artifact files (~677MB), которые Vite watcher по умолчанию не исключал. Добавлен только `server.watch.ignored: ['**/e2e/.artifacts/**']`; это подтверждённая hygiene-проблема, но точная причина тайм-аутов пока не доказана повтором. Budgets не увеличены. Companion `testIgnore` исключает copied specs; CLI discovery126/6/1, strict E2E и Vite config noEmit exit0.

Canonical WebKit poster401 оказался ошибкой fixture parity: `transport.raw` использовал fetch без Authorization, в отличие от production `rawAuthenticated`. Trace содержит image-purpose header без Bearer; service worker корректно отвергает запрос, когда нет ни request Authorization, ни ещё доставленного client token. Production media token/SW не изменяется. Synthetic authenticated transport исправлен; отсутствующий memories-list handler добавлен с общими detail/list mode transformations. Ordinary mode ready, explicit poster-processing и failed mode pending до poster-ready. Root проверил actual diff, strict E2E exit0 (`lead/e2e-typecheck-final-r4.log`), lint0, diffcheck0 (`lead/diff-check-final-r2.log`); runtime повтор ещё PENDING.

Внутри default run Agent K снова прошёл42 unique scans: contrast0, unapproved0, accepted exact viewport42 (`lead/accessibility-default-final-summary.json`).

Initial case52 helper с 0мс timer не прошёл uninstrumented browser. Diagnostic wrapper показал правильную регистрацию guard и trusted retargeted click, но мог менять timing; его green не принят. Lead isolated post-fix comparison подтвердил: next-task click спустя10мс проходит при0мс и блокируется при900мс (`lead/guard-task-boundary-probe.log`, exit0). Новый async unit не запускался до реализации: это не заявляется как TDD RED. Temporary main/test diagnostics удалены; `main.tsx` actual diff пуст.

## Независимое ревью и визуальная приёмка

Первое whole review нашло три P2 CI completeness, исправлено назначенным worker; следующее whole review подтвердило исправления. Narrow reviews проверили E2E/type gate, контраст, lifecycle/cache. Reviewer подтвердил и исправил unit coverage gap: keyboard/off-coordinate проверяются после owned pointerup, до matching click.

Последнее fresh whole review `review_final_preprod_whole_r2` проверило весь active diff и новые task files, не выявило unresolved P0/P1/P2, production edits не выполняло. Его дополнительные checks: tooling+smoke27/0 (86expects), guard3/0 (13expects), avatar+smoke8/0 (25expects), diffcheck0. Статическое review принято; итоговый runtime gate остаётся обязанностью lead. Старый reviewer pending-verification verdict не считается новым code finding.

Новое fresh whole review `review_final_preprod_whole_r3` подтвердило P2 в Docker smoke resource lifecycle: shared per-worktree Compose project reused, затем cleanup безусловно удалял его Postgres service и named volume. Lead проверил source и принял finding. Reviewer исправил bounded scope: smoke-only UUID project/network/volume/container, отдельный free host PG port и synthetic DB URL, cleanup только owned resources, ambient DB/container overrides игнорируются. Unit сначала RED missing helper, затем GREEN3/0; отдельный network cleanup RED2/1 →GREEN3/0. Root повторил3/0 и проверил actual diff. Реальный Docker smoke с foreign synthetic sentinels ещё PENDING. Reviewer additional pure checks37/37; browser sources во время runs frozen. После adjudicated fix требуется ещё одно fresh whole review.

Windows poster6 после auth/list fix:4pass/2fail, exit1 (`e2e/poster-final-r2.log`). Оба failure — four-portrait preview screenshot после второго Previous: active index меняется по Embla select до окончания движения, тест не дожидался active position2/ready/decode/settlement. Trace показывает334/335px crop и WebKit pending→ready. Lead просмотрел expected/actual пары, baseline updates и увеличения tolerances не одобрял. Назначена spec-only synchronization; runtime PENDING.

Spec-only synchronization реализована: pinned position2, active/ready/visible poster/naturalWidth>0, stable transform и положение slide относительно viewport через два animation frames. Это проверка intrinsic dimensions, а не явный `HTMLImageElement.decode()`; screenshot отдельно ждёт loaded images. Root inspected diff, strict E2E exit0 (`lead/e2e-typecheck-final-r5.log`), scoped lint0. Original assertions/budgets/baselines сохранены.

Poster-r3 после synchronization снова4/2 exit1; readiness/active/alignment wait прошёл, dimensions стабильны334×419. Chromium10pixels и WebKit376pixels; actual PNG hashes в r2/r3 идентичны. Root дополнительно просмотрел diff: circle/triangle raster edges; WebKit duration glyph и bottom row. Одобрены только two four-portrait-preview Win32 baselines; broad tolerance не меняется. Всего8 Windows PNG одобрены визуально, final6no-update повтор PENDING.

Poster-r4:4/2 exit1; four-portrait assertions прошли, следующий carousel-preview334×418→334×419 не совпал с baseline. Для визуальной приёмки создан ignored временный config со snapshotPathTemplate только в ignored candidate directory. Диагностический run выбирал2 first cases, сохранял18 PNG, exit0; это не acceptance GREEN (`e2e/poster-candidate-r1.log`). Root просмотрел все10 remaining expected/candidate пары (carousel-preview/landscape paused+playing/portrait preview+playing, два browsers), подтвердил одинаковую композицию и controls с одной дополнительной raster row. Existing portrait capture содержит такой же BottomNav overlay, как старый baseline; production framing не меняется. Только10 dimension-changed PNG approved для копирования; другие8 не перезаписаны, WebKit equal-pixel reencoding не переносится. Итого18 Windows PNG отдельно просмотрены и одобрены, общий no-update6 повтор PENDING.

Финальное fresh review `review_final_preprod_adjudicated` не подтвердило unresolved P0/P1/P2 по whole active diff. Reviewer перечислил actual source evidence для PG lock ordering/caption reread/avatar predecode/release gate/planner/guard/fixtures/contrast/owned Docker cleanup, source edits и tests не выполнял. Lead принимает только static review clear; первоначальный слишком сильный label production_ready reviewer отозвал. Runtime gates остаются отдельными обязательными проверками.

Lead просмотрел canonical/actual photo-empty при320px, четыре Windows preview и две mixed-portrait-playing actual/expected пары, четыре representative Linux screenshots. Четыре Windows preview PNG обновлены только после подтверждения изменения высоты1px; два Windows playing PNG обновлены таким же узким образом334×419 →334×418 после сверки exact expected hashes. Общие tolerances не менялись. 18 Linux PNG сняты настоящими Linux browsers. Lead просмотрел Family screenshots всех шести themes: mint, rose, sky, lavender, apricot, sand (`lead/family-contrast-{theme}.png`); новый foreground читаем, layout не нарушен. Frozen canonical HTML/hash не изменён, fonts/layout/borders/backgrounds сохранены.

## Docker, ограничения и rollback

Проверенный runtime image `memoly-backend:preprod-cache-20261008`, digest `sha256:12e011b973aa3e834b2a3dfa8a4bfd31b0325c89be56ed79a469e8a5a9245ff3`: linux/amd64, USER bun, Sharp synthetic2×2PNG95bytes. Cold installs729.5/758.3s; source-only cache proof дал CACHED install и source COPY miss (26.8s target, 3.45s full — worker evidence). Lead/reviewer проверили сохранённые log milestones; temp context contents/outer process exit отдельно lead не воспроизводил. Образ собран до поздних frontend/test-manifest изменений; это не final-source release artifact или staging certification.

Linux runner: Debian13 trixie amd64, а не Ubuntu GitHub runner. Image `ourmemories-playwright-runner:20261008`, digest `sha256:665aa72749db62a44672543c84d15b1115c2d1138c00f50f789d910d28274e95`; actual launched browsers Chromium151.0.7922.34/WebKit26.5, PW1.62.1, Node20.19.2, Bun1.4.0, FFmpeg7.1.5 (`runtime-final.stdout.log`). Final runtime6/6 exit0 with no-update snapshots; lead прочитал full stdout, exit marker, passed `.last-run.json` и counted6trace.zip. Host results path: `webapp/e2e/.artifacts/linux-poster-repeat-20261008/artifacts/linux-poster-repeat-20261008-r2-results/`. Owned Vite/container removed, host logs preserved. 18 Linux PNG unchanged. Ранние Linux stdout только в tool transcript остаются historical, новый persisted result authoritative.

Owned smoke первый run мигрировал synthetic DB, builder frozen install прошёл229packages/504.71s; production install упал при распаковке `@ffprobe-installer/linux-x64`540–555s. Не считается successful runtime smoke. Cleanup удалил только UUID project service/volume/network; synthetic foreign container/volume сохранились, затем удалены lead как созданные им sentinels. Root подтвердил отсутствие resources failed project's label. Registry tarball HEAD200; overlay907GB available, host C13.8GB/D59.9GB available, доказанного disk exhaustion нет. Повтор frozen build нужен; bypass install или lock mutation не применялся.

Frozen retry owned smoke exit0: builderinstall CACHED, production install226packages/273.76s, Prisma generate passed. Новый local image `memoly-backend:preprod-owned-smoke-20261008`, imageID/manifest-list digest `sha256:659953be26e2f7fb2683a4e249d68449ae95d627c064fd5c386e21fa4dfcf20b`, linux/amd64 USERbun. Root реально запустил Sharp0.35.5: synthetic2×2PNG95B. health/ready и DB-backed browser-link challenge/cookie/pending passed. Foreign synthetic container+volume preservedtrue, затем удалены lead; owned UUID project service/volume/network отсутствуют по Docker label queries. Runtime metadata `lead/docker-owned-image-runtime-final.json`. Fresh image включает текущий production backend/source/deps; это local verification artifact, не staging promotion или опубликованный release digest.

Linux refreshed source fingerprint lead сравнил с live worktree:584 exact SHA matches, одна дополнительная служебная `webapp/e2e/.placeholder` отсутствует в host (`lead/linux-source-fingerprint-comparison.json`). Это snapshot до последнего two Win32 baseline approvals; Linux18PNG unchanged.

После refresh всех approved Win32 PNG actual browser launch подтвердил Chromium/WebKit на Debian13. Первый Linux runtime repeat не принят: Vite pre-transform не разрешил `assets/manifest.json` и `docs/mvp/design/ui-copy.ru.json`; initial source whitelist пропустил два родительских runtime JSON. Fingerprint equality проверяла только скопированные файлы и не доказывала completeness dependency closure. Chromium первые cases упали до корректного app mount; runner остановлен для bounded preparation repair, failed stdout/traces сохранены в `webapp/e2e/.artifacts/linux-poster-repeat-20261008/artifacts/linux-poster-six.stdout.log`. Назначено копирование двух public JSON и проверка остальных escaping static imports; никакой product code/baseline change. Повтор6no-update PENDING.

Linux preparation repair completed: two public JSON hashes match host, fixture HTTP200/PAGE_ERRORS=[], vendorCSS present; other escaped import only unrelated dev DesignSystem beach route. R1 exact-owned runner intentionally terminated exit143, partial failures не считают six-case result. R2 six cases прошли. Final manifest587 files SHA `2ff3d2af540cbf9e517fc1989f190a6ea3ee623452bbd87763fb3b6173c94494`; lead live-host comparison584 matches +служебный placeholder absent +2 unused Win32 four-portrait PNG stale. Runtime app/spec/JSON и18Linux reference PNG совпадают; Win32 variants в Linux run не используются. Entire587 current-host equality не заявляется (`lead/linux-source-fingerprint-comparison-final.json`).

Known-advisory audit не доказывает отсутствие всех уязвимостей. Passing axe с принятой page-zoom limitation не означает полного WCAG compliance. Inter cache даёт exact-byte determinism внутри run; cold cache не pin неизменяемой upstream revision. Production remote fonts/performance требуют внешней проверки. Fixture adapters не полностью повторяют production HttpClient credential/error semantics, текущие запросы same-origin.

Локальные результаты не заменяют staging promotion по digest, real-device Telegram/MAX/PWA smoke, restore drill, нагрузочную приёмку и новый GitHub Verify на опубликованном SHA. Production migrations/deletes, реальные приглашения/Telegram calls и deploy не выполнялись. Schema/contracts не менялись; rollback кода обычным обратным commit, migrations отсутствуют.

Удаление exact synthetic context `C:/Users/Alexandr/AppData/Local/Temp/OurMemoriesDockerCacheProbe-20261008` отклонено автоматической проверкой разрешений: `blocked by policy`, даже после проверки resolved path/reparse points. Контекст оставлен; запрет не обходился. Owned Docker resources/cache-proof tags очищены, unrelated Bun PID48320 не трогался.

Changed paths/allowlist: backend jobs/caption repository/avatar validator + race fixture/tests, Dockerfile/smoke; workspace package manifests/bun.lock/vendor CSS; verify/release workflows/planner/gate/tests/docs; webapp FeedPage/presentation guard/unit tests; scoped Family CSS; E2E specs/helpers/configs/fixtures/platform snapshots/tsconfig; website dependency/CSS import. Полная доказательная история и отдельные failed/focused runs: [evidence history](preprod-fix-20261008-evidence-history.md). Этот файл описывает итог; исторические pending записи в evidence superseded текущими результатами.

Последний default-r2 завершился108pass/2fail/16did-not-run, exit1,126selected,24.9min. Case74 RED при `continueToRestoredFeed` после второго reload; captured DOM — family hub. Следующие15 serial Feed cases did-not-run. Второй RED — Matrix Video Viewer loading case113 после fixture install/reload, ожидаетсяFeed, capturedDOMhub; следующийcase114did-not-run. Companions не запускались. Scout обнаружил missing prerequisite case74: перед reload нет readonly IndexedDB assertion `{screen:'feed', selectedFamilyId:fixture.familyId}`, хотя два других restored-feed callsites его имеют. PrivateCacheGate writes debounced120ms. Это causal candidate, а не доказательство product persistence defect. Lead разрешил только existing readonly poll перед reload, с сохранением automatic restoration/error/retry assertions и budgets. Если persisted poll не проходит, требуется расследование product path; family-click fallback запрещён. Дляcase113 отдельно проверяется аналогичное prerequisite. Новый full batch обязателен после bounded fix и review. Current raw Agent K:42unique/contrast0/unapproved0/acceptedviewport42 (`lead/accessibility-default-final-r2-summary.json`);90sourcefreeze hashes совпали до новой spec-only правки.

# Changed paths at final verification

Case74 readonly-persistence prerequisite focused3/3 и Matrixloading/error focused6/6 прошли no-update, exit0 (`e2e/feed-case74-repeat-r1.log`, `e2e/matrix-viewer-persistence-repeat-r1.log`). Helper только читает существующий private-cache IDB, family fallbackclick/writes отсутствуют, restore/error/retry/geometry/requestcounts/budgets сохранены. Scopedtsc/lint0 подтвержденыtooloutputs; из-за empty stdoutTeeфайлы этихдвухchecksнесозданы, ихналичие не заявляется.

Voice fix реализован feed-scoped helper/current-attempt guard: caught rejectedplaypromise, stalecompletion не меняетstate; pause/ended/srcchange/unmount/newclickinvalidates. Sharedplatformhelper не изменяется. Новый regressionunit3 проверяетAbort/staleAbort/nonAbort+nextvalidplay+pause. WorkerbehavioralRED3fail послеprep-extraction oldawaitbehavior подтверждёнtoolresult, исходныйREDstdoutне сохранён; initialmissingmoduleREDне засчитывается, reconstructedlogsне создавались. GREEN13/0focused31expects saved `voice-cancellation/green-unit.log`. Root inspected actualdiff, fullwebunit474/0/3265expects74files exit0 (`lead/webapp-unit-final-r2.log`); all-workspace typecheck0 (`lead/typecheck-final-r3.log`), lint0 (`lead/lint-final-r6.log`), architecture807files0 (`lead/architecture-final-r4.log`), template0 (`lead/template-final-r4.log`), bothbuilds+contracts3/0 (`lead/build-contracts-final-r2.log`). Ошибочно добавленная browserassertion в соседнийmixed-reactionscase удалена boundedworkerfix; rootпроверилactualcase68 sequence/Range assertions и восстановленныйcase85. Case68 добавляетlocalpageerrorcollector/Listenafterhide/finalnoAbort assert, budgetsне менялись. Natural browser run pending. Новыйfreeze92hash SHA `96e7815304e70f76fc723e4e6509623102eaf713bf6892d9837bb674bdff2b9b`.

Freshreview `review_preprod_voice_and_whole_final` staticfindingsempty; runtimependingverdictнеproductionready. Reviewerexplicitlyinspected voiceattemptownership, Apppersistentroute, PGlocks, release/Dockerboundaries. Secondfreshwhole reviewinprogress. Его предположениеarbitraryrefNodeexecution доSHAvalidationrootотклонил поactualworkflow: pinnedcheckout→fixedshell exactorigin/mainvalidation→Nodeverifier. Reviewerсогласилсяиотозвалfinding, codepatchне делался. НовыйcurrentLinuxR3soleowner, staging589files fingerprint `deefd610dcbb66e72dccb4d54f6d421e5a720d8f6225bdb99337899b4fd2617d`; currentapp/helper/spec/JSONand18Linuxrefs, copiedapprovedWin32refs, no snapshotsupdates.

Default-r2 logline542 во время passing case68 содержит `[Unhandled rejection] AbortError: play() request interrupted by pause()`. Scout и lead проверили actual source: AudioPlayer запускает void async wrapper с `await toggleMediaPlayback` без catch; helper напрямую awaits `element.play()`, coordinator visibilitychange вызывает pause. Test evaluate только моделирует hide, play идёт через production UI. Это не доказывает high-impact functional failure, но подтверждает незакрытый product rejection path. Назначен fresh worker `fix_voice_play_cancellation`: deferred-play regression RED→minimal fix→GREEN с проверкой success/pause/Abort/nonAbort/следующего playback и отсутствия stale state. До завершения sole browser run edits/tests запрещены. Временная последовательность: case74 focused fix, lease return, voice fix, final fresh review/root checks, natural case68, новый полный batch. Existing final static review относится к diff до этой новой правки.

- `.github/workflows/selectel-release.yml`
- `.github/workflows/verify.yml`
- `backend/Dockerfile`
- `backend/package.json`
- `backend/scripts/docker-smoke.mjs`
- `backend/scripts/docker-smoke.test.mjs`
- `backend/src/jobs.ts`
- `backend/src/modules/media/infrastructure/reservation-race.integration.test.ts`
- `backend/src/modules/telegram/infrastructure/caption-race.integration.test.ts`
- `backend/src/modules/telegram/infrastructure/prisma-caption-repository.ts`
- `backend/src/race-regression-fixtures.ts`
- `backend/src/storage/normalize-avatar-image.test.ts`
- `backend/src/storage/normalize-avatar-image.ts`
- `bun.lock`
- `deploy/selectel/README.md`
- `docs/DEPLOYMENT.md`
- `docs/mvp/review/AGENT_K_ACCESSIBILITY_DECISION.md`
- `docs/reports/preprod-audit-20261007-plan.md`
- `docs/reports/preprod-audit-20261007.md`
- `docs/reports/preprod-fix-20261008-evidence-history.md`
- `docs/reports/preprod-fix-20261008-plan.md`
- `docs/reports/preprod-fix-20261008.md`
- `package.json`
- `scripts/require-release-verification.mjs`
- `scripts/verify-plan.mjs`
- `tests/require-release-verification.test.ts`
- `tests/verify-plan.test.ts`
- `vendor/shadcn/LICENSE`
- `vendor/shadcn/README.md`
- `vendor/shadcn/tailwind.css`
- `verification-map.json`
- `webapp/e2e/adult-avatar-harness.tsx`
- `webapp/e2e/adult-avatar.spec.ts`
- `webapp/e2e/agent-k-accessibility.spec.ts`
- `webapp/e2e/child-avatar.spec.ts`
- `webapp/e2e/feed.spec.ts`
- `webapp/e2e/global-setup.ts`
- `webapp/e2e/helpers/inter-font-cache.ts`
- `webapp/e2e/helpers/test.ts`
- `webapp/e2e/private-video-poster.fixture.tsx`
- `webapp/e2e/private-video-poster.spec.ts`
- `webapp/e2e/private-video-poster.vite.config.ts`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-carousel-preview-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-four-portrait-preview-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-paused-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-playing-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-landscape-preview-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-playing-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-mixed-portrait-preview-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-playing-webkit-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-chromium-win32.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-linux.png`
- `webapp/e2e/private-video-poster.spec.ts-snapshots/private-video-portrait-preview-webkit-win32.png`
- `webapp/e2e/specs/family.spec.ts`
- `webapp/e2e/specs/missing-visual-matrix.spec.ts`
- `webapp/e2e/specs/mm1-mixed-composer.spec.ts`
- `webapp/e2e/specs/welcome.spec.ts`
- `webapp/e2e/warm-navigation-cache-regression.spec.ts`
- `webapp/e2e/warm-navigation-cache.fixture.tsx`
- `webapp/package.json`
- `webapp/playwright.config.ts`
- `webapp/README.md`
- `webapp/src/features/feed/FeedPage.tsx`
- `webapp/src/features/feed/presentation/MemoryCardPresentation.tsx`
- `webapp/src/features/feed/presentation/retargeted-touch-click-guard.ts`
- `webapp/src/features/memoly-ui/family-management.css`
- `webapp/src/features/memoly-ui/memoly-ui.css`
- `webapp/src/index.css`
- `webapp/tests/retargeted-touch-click-guard.test.ts`
- `webapp/tsconfig.e2e.json`
- `webapp/vite.config.ts`
- `website/package.json`
- `website/src/styles/global.css`


## Windows default-final-r3: native worker failure

Current frozen source; no-update, 126 selected, 125 passed / 1 failed / 0 skipped, exit1, 28.2m. Case98 passed; case99 `keeps Family and Settings within the viewport at supported mobile widths` was reported 0ms with `worker process exited unexpectedly (code=3221226505, signal=null)`. No assertion error or case99 trace/error-context was produced. Cases100–126 passed. Evidence: `webapp/e2e/.artifacts/fix/e2e/default-final-r3.log` and its results `.last-run.json` (failed). This run is not acceptance. Poster/warm companions were not started after RED. Owned fixture PostgreSQL was stopped/removed; Vite port56376 had no listener after exit. Source/snapshots unchanged.

Lead independently read final failure and .last-run. Read-only Windows Application1000/1001 query for previous two hours returned no events; it did not establish the cause. Scout found no confirmed causal route lifecycle defect; a process crash alone does not justify a source patch. A focused sequential pair98/99 repeat3 is assigned with unchanged source and no-update, before any new whole acceptance run.

Decimal3221226505 equals hexadecimal0xC0000409. Microsoft documents this as the exception code used by user-mode [fast-fail](https://learn.microsoft.com/en-us/cpp/intrinsics/fastfail?view=msvc-170); the code alone does not identify the native failing component or prove a stack overrun. Runtime inventory: Bun1.4.0, PATH Node24.15.0, Playwright1.62.1; inventory is evidence about installed executables, not a proved native root cause. Focused pair repeat3 is running with one worker, unchanged source and no-update.

Focused pair repeat3 completed GREEN: 6 passed / 0 failed, exit0, 2.9m; three theme-context runs and three viewport runs in one serial command, no-update, source unchanged. Lead read full summary, six passed list entries and passed .last-run.json; unhandled-rejection lines0. Evidence: `webapp/e2e/.artifacts/fix/e2e/family-worker-crash-repeat-r1.log`, its results directory and `worker-crash-runtime-r1.log`. Owned fixture container and Vite/DB listeners absent after exit. Lead verified source freeze92/0 mismatches before new whole run in `lead/source-freeze-verification-before-default-r4.json`. The native process failure did not reproduce; its cause remains unknown. Final default-r4 is assigned with unchanged source/no-update, companions only after exit0; a second native failure must be escalated rather than hidden by endless retries.

## Resumed Windows poster acceptance after interruption

At owner request to continue, root found default-r4 complete GREEN126/0 exit0, but poster-r6 stdout ended after four passes and two WebKit failure entries, with no final summary/exit-code/.last-run. Case5 trace/error-context records spec225 toHaveCount(0) receiving undefined immediately; case6 has0ms and no trace. Root independently read the trace: protocol `_Frame.expect` returns ExpectError, without numeric DOM count or a proved browser-close cause. The incomplete command is not acceptance and no final exit code is fabricated. All known owned PIDs/listeners gone; current92source hashes unchanged. Read-only scout did not establish a product defect or interruption cause. Exact artifacts preserved.

A fresh worker is assigned one full poster-r7 no-update command on unchanged source, followed by warm-r2 only if6/0exit0. Any new RED stops companions and requires causal diagnosis before mutation. No source/config/baseline changes are authorized by this runtime task.

## Final current-source acceptance

Root personally verified final Windows summaries/list entries, actual exit markers0 and .last-run passed: default-r4 126/0 (27.1m), poster-r7 6/0 (2.0m), warm-r2 1/0 (50.8s), total133, no skips, unhandled rejection lines0. Source92/0 mismatches at final comparison; no source changes during runs. Source-aware static reviews already completed before freeze; no further code review loop required. Final exact evidence paths remain in main report.

No listeners remain on owned ports4197/4193/56376/31376. Final read-only Docker cleanup recheck could not connect to Docker Desktop Linux API because its daemon is not running; this probe returned1. Prior owned Docker smoke and default PostgreSQL teardown were actually recorded success before daemon shutdown. No daemon restart or global cleanup was performed. This later metadata-probe failure is not hidden as an executed successful container check.
