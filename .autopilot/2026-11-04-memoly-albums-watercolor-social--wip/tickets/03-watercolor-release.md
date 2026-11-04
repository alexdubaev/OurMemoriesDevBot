# 03 — Акварель четырёх внутренних экранов и общая приёмка

**Требования:** G01, R64, R67, R01, R02, R03, R04, R52, R53, R54, R55, R56, R57, R58, R59, R60, R61, R62, R63, R65, R66, R68, R69, R70, R71, R72, R73, R74, R75, R76, R77, R78, R79
**Зависит от:** 02
**Зона:** `webapp/src/features/albums/` · `webapp/public/assets/albums/` · `assets/` · `docs/design/` · `webapp/e2e/` · `docs/reviews/` · `deploy/selectel/redeploy.sh` · `tests/`
**Волна:** 3
**Ревью:** нет — одно итоговое review
**Модель:** сильная

## Что должно заработать
Утверждённый первый акварельный вариант FULL original/ZIP, отдельные optimized assets, четыре реальные internal screens, photo-first и компактные controls. Каталог не менять. Social UI уже подключён. Сохранить все workshop/year/events/free behaviors, themes/readability; no actual photo publication, no screenshot UI. Final verification/review/PR/release orchestration belongs to /root, not executor; requirement rows for those are closed only after actual evidence.

## Из брифа, дословно
> «reference.html из PR #270 — упрощённый обезличенный пример.»
> «Не заменять акварель emoji»
> «КАТАЛОГ «АЛЬБОМЫ» НЕ РЕДИЗАЙНИТЬ.»
> «Не выпускать в production каждый внутренний этап отдельно.»

## Разделы спецификации
Истории 9–11, последовательность доказательств, интеграция и выпуск, завершение; full original source path from lead.

## Критерии приёмки
- [ ] First watercolor palette/hills/bear/bunny/plant assets faithfully transferred; existing photo/media pipeline used, no private photos in Git.
- [ ] Compact header/menu/add, description/settings secondary; gallery immediate, no tall intro/add strip/control floors; theme/readability/text enlargement, touch targets and no 320px overflow.
- [ ] Workshop dense 8/5/3 collage/category/year/month/pinch/buttons/virtualized pagination/scroll anchor; year 12 actual filled/empty compact chapters/history-overview; events text-only/partial unknown/suggested custom; free source/order/editor unchanged.
- [ ] Catalog before/after same synthetic data matches; bottom 5 nav intact. Four actual screens 320/390/430 + large text empty/filled compare full reference; screenshots external task evidence.
- [ ] Targeted test/type/lint/build and real browser evidence; docs replace UI-only with combined social/data/API task. No deploy guards/dependency changes.
- [ ] /root integration: one final independent technical review + bounded fixes/narrow closure; exact-source FULL; merge main safely/squash PR/final SHA. Guarded single release with actual SHAs/jobs/diff/migration compatibility/backup/disk/lock/immutable artifacts/measured recovery/S3 preservation/public read-only smoke. Cleanup own branch/worktree only after merge; final complete truthful handoff and physical iPhone/MAX manual checklist, measured time.

## G01 — точечно разрешённое дополнение release guard
После freeze визуального source применить ровно подготовленный s3-album-social proposal с вычисленным final executable fingerprint вместо PENDING. Pins: baseline63 commit6de3da8 и ровно migration20261104110000/20261104113000 с exactLF/CRLFchecksum. Existing locked preSQL prefixes63/64/65; complete65 and matching schema; original s3 still complete-only. Ничего в ci-release ordering/hostguards/backup/S3/noDBrestore не менять. Actual code+tests join same finalreview/FULL/PR/release; no separate deployment task. Product design executor does NOT write guards; root serially assigns exact repair to recovery executor after visual commit.

## Готовые входы оформления
PR270 supplement1906f549: external D:/codex/TG_OurMemoriesDevBot/task-evidence/MEMOLY-ALBUMS-WATERCOLOR-AND-SOCIAL/design-source-1906f549/{reference-full-safe.html,watercolor-overrides.css,assets/}. README says genuine first watercolor art, only demo photos substituted. Root viewed references; loopback55791 serves safeHTML; selected page IDs workshop/year/year-grid/events/free/month1..12. Before screenshots and reference screenshots external task folder. Catalog before used old fixture?albums=3 which clamped24; compare after using?albums=24 (same24fixed materials), don't claim oldbaseline3. Newfixtureallowsreal3foracceptance.
Reference #free has globaldemo.work filter hidinggallery: don't copy CSS-state bug, actualReactgalleryimmediatelybelowshortheaderrequired. NoJS hash/:target/nav isn't production. Don't copy demo black topbar or demo bottomnav icons; keep actualshell/5buttons. Genuine artwork source5WebPs RGB/opaque paper; no fake transparency claims, preserve actual art and assess theme background integration. Read ASSET_GUIDE and manifest conventions, optimizedlocalassets only. No screenshot slicing/privatephotos/newgeneratedart needed.
