# F1 — Правки по ревью фильтра дат

**Требования:** R01, R05, R06, R07i
**Зависит от:** —
**Зона:** `packages/contracts/src` · `webapp/src/features/feed` · `webapp/tests` · `webapp/e2e`
**Волна:** 2
**Ревью:** да — ремонт ветки
**Модель:** сильная

## Что должно заработать

На широком экране отображается ожидаемая строка выбранного периода. После исправления даты записи старый период обновляется при возврате. Недоступная в часовом поясе историческая дата не создаёт некорректный запрос.

## Из брифа, дословно

> «можу выбрать год, или месяц в определеном году, или последовательность месяцев или определенный день»

## Разделы спецификации

Решение R01, R05, R06, R07i. Реализованные интерфейсы.

## Критерии приёмки

- [ ] P2 Spec `webapp/src/features/feed/presentation/astryx-feed.css:122` desktop explicit grid loses `period`; place applied chip beneath heading in wide layout.
- [ ] P2 Spec `webapp/src/features/feed/FeedPage.tsx:377` edits/publications for a single-child family refresh only active cache; with multiple period keys, a prior recent archive cache serves stale placement (or unread cache at Infinity) after event-date edit. Invalidate family feed lists as for multi-child, without refreshing inactive snapshots eagerly.
- [ ] P2 Spec `webapp/src/features/feed/date-period.ts:23` and `DatePeriodSheet.tsx:60`: `Pacific/Apia` 2011-12-30 is selectable but converts to equal 2011-12-30T10:00:00.000Z bounds and gets 422; treat a skipped civil day as unavailable in picker or an empty period without invalid API request.
- [ ] P2 Spec `packages/contracts/src/memories.ts:70-71`: `occurredAtSchema` accepts signed offsets (`datetime({offset:true})`), while interfaces say both new parameters are ISO UTC; enforce UTC for this new pair and demonstrate boundary with contract test.
- [ ] P3 Craft `webapp/e2e/memoly-v4.spec.ts:972-974` reset assertion false-green on the initial unfiltered request; verify chip disappears and/or resulting unfiltered fixture output, handling legitimate warm cache reuse.
