# PERF-1 BEFORE timing

Measured in the browser composer test harness before any upload concurrency change. Synthetic JPEG files are 128 bytes each. The mocked transport waits 5 ms per reserve, 8 ms per byte transfer, 6 ms per finalize, 7 ms for Memory create, and 4 ms for the `onSuccess` callback. All files are processed in selection order. Numbers below are one observed Bun 1.4.0 run on 2026-09-29, rounded to milliseconds; timer scheduling makes repeat runs vary.

| Files | Validation | Reserve total | Bytes total | Finalize total | Wait for all attachments | Memory create | Feed callback |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | <1 | 6 | 9 | 7 | 21 | 7 | 4 |
| 5 | <1 | 30 | 43 | 33 | 106 | 8 | 4 |
| 10 | <1 | 57 | 87 | 66 | 210 | 8 | 5 |

The attachment loop is serial. Its reserve, byte upload, and finalize waits scale approximately with file count; Memory creation and the feed callback occur once. With these mock delays, byte transfer is the largest individual stage (87 ms of 210 ms at 10 files). The whole per-file sequence is the bottleneck, rather than validation or Memory creation. These numbers do not estimate real network, storage, MAX, or production performance.

`PhotoComposer` exposes an optional `onTiming` callback with only stage, duration in milliseconds, and selection index. It does not pass file content, caption, URLs, tokens, IDs, or keys. No callback is attached in production. `provider_processing` measures the client-observed MAX finalize wait after byte transfer; provider start/ready events are not separately exposed by the current API. `feed_refresh` measures the supplied `onSuccess` callback after the user presses “Смотреть в ленте”; it may include navigation and is not an isolated network refetch measure. `wait_all` includes all attachment stages and React/test scheduling overhead, so it should not be added to the per-stage totals.

The BEFORE samples were recorded with `bun test webapp/tests/photo-composer.test.tsx --test-name-pattern "PERF-1 BEFORE"` before the scheduler change. That historical command is no longer executable against current code.

## AFTER timing (two concurrent attachment chains)

The composer now runs up to two reserve/upload/finalize chains at once. The table below is one observed run of the same Bun 1.4.0 synthetic harness on 2026-09-29. Per-stage totals sum time spent by individual files, including overlapping time. `wait_all` is elapsed wall time until every active chain settles. Timer scheduling varies between runs.

| Files | Validation | Reserve total | Bytes total | Finalize total | Wait for all attachments | Memory create | Feed callback |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | <1 | 6 | 9 | 7 | 22 | 8 | 6 |
| 5 | <1 | 29 | 46 | 35 | 65 | 8 | 5 |
| 10 | <1 | 59 | 86 | 72 | 109 | 8 | 5 |

Compared with the observed BEFORE run, `wait_all` changed from 106 to 65 ms at five files (39% less) and from 210 to 109 ms at ten files (48% less). One file has no parallel benefit. These are synthetic observations, not production network benchmarks. The test also checks a maximum of two overlapping chains, reverse completion relative to selection, and one ordered Memory request.

Reproduce: `bun test webapp/tests/photo-composer.test.tsx --test-name-pattern "PERF-1 AFTER"`. The historical BEFORE numbers above were recorded before changing the scheduler; that test name is no longer executable against the current code.
