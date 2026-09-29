# Dependency and parallel plan

After spec import:

```
                fresh main
                    |
        +-----------+-----------+
        |           |           |
      CAR-1       PERF-1      MAX-1
        |           |           |
        +-----------+-----------+
                    |
                  INT-1
                    |
            separate deploy
                    |
          owner real-device PASS
```

## CAR-1
**Лента — единая карусель photo-only + mixed, стабильная геометрия и readiness**

Owns:
- Feed presentation;
- Embla/media-stage;
- viewer integration;
- pending/ready/unavailable UI;
- photo-only normalization.

Avoid:
- upload orchestration;
- MAX backup writes.

## PERF-1
**Загрузка — проценты, timing и ускорение**

Owns:
- composer upload state;
- progress;
- upload orchestration;
- bounded concurrency;
- retry/cancel.

Avoid:
- Feed carousel CSS;
- MAX backup provenance model.

## MAX-1
**MAX backup — photo albums/mixed + live-ingestion regression**

Owns:
- MAX provider adapter/outbox;
- durable provider references;
- outbound backup publication;
- idempotency/dedupe;
- live MAX → memoLy regression.

Avoid:
- Feed redesign;
- progress UI.

## Parallelism
CAR-1 / PERF-1 / MAX-1 may run simultaneously in separate chats/worktrees.

Potential shared areas:
- memory/media contracts;
- MAX attachment DTOs;
- readiness fields.

Shared contracts should be frozen where possible. Any necessary shared change must be minimal and documented.

## Review queue
Sol agents may run in parallel.
Maximum ONE Luna High reviewer globally.
Reviews queue sequentially.

## INT-1
Starts only after CAR-1 + PERF-1 + MAX-1 merged.
Proves one coherent media system end-to-end.

## Deploy
Implementation tasks are code-only.
Production deploy is a separate task after INT-1.

## Telegram
No task waits on Telegram.
