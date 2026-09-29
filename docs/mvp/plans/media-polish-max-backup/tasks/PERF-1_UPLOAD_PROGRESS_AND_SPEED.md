# PERF-1 — Upload: проценты, timing и ускорение multi-file upload

## Goal
Сделать upload понятным и быстрее без ослабления safety.

## Scope
Primary:
- composer upload state;
- progress UI;
- upload orchestration;
- timing;
- bounded concurrency;
- retry/cancel.

Avoid:
- Feed layout;
- MAX backup provenance model.

## Measure first
Record:
- validation;
- reserve;
- bytes upload;
- finalize;
- provider processing start/ready;
- wait-for-all;
- Memory create;
- Feed refresh.

Identify actual bottleneck before optimization.

## Progress UX
Single:
- percentage where transport exposes bytes.

Multiple:
- aggregate byte progress where meaningful;
- `N из M` / per-file state if useful.

After upload bytes = 100%:
- switch to provider processing state when needed.

## Performance
If timings justify:
- bounded parallelism;
- preserve selection index independent of completion order;
- cap provider/storage concurrency;
- respect rate limits;
- avoid memory spikes.

## Safety
- at most one Memory per logical create;
- no incomplete Memory;
- safe retry of finalized assets;
- no duplicate MAX send;
- no duplicate photo upload;
- clear cancel semantics.

## Investigate
- repeated full-file reads;
- duplicate hashing/decode;
- serial reserve/finalize that could be bounded-parallel;
- unnecessary wait for MAX readiness before Memory create;
- redundant Feed refetch per attachment;
- duplicate poster resolution.

## Safe diagnostics
Allowed:
- size;
- duration;
- request IDs;
- error classes.

Never:
- bytes;
- captions;
- signed URLs;
- tokens;
- private keys.

## Tests
- monotonic 0..100;
- multi-file aggregate;
- 100%→processing;
- 5/10 files;
- completion order ≠ attachment order;
- transient failure+retry;
- partial failure no Memory;
- cancel;
- double submit;
- concurrency cap asserted;
- standalone MAX video regression;
- photo-only regression.

## Handoff
Include:
- measured bottleneck;
- concurrency before/after;
- progress calculation;
- retry/cancel;
- timing comparison;
- tests;
- Luna;
- deploy NOT performed.
