# Gift share paste implementation plan

> For agentic workers: implement the single bounded task with a failing regression, minimal change, and narrow verification.

Goal: paste the owner's unchanged Wildberries Share text into the existing gift form successfully.

Architecture: frontend clipboard normalization using the unchanged gift URL schema; no API, contract, storage, ACL, migration or dependency changes.

Spec: ../specs/2026-10-24-gift-share-paste-design.md

## Task 1 — Clipboard boundary

Allowed paths: webapp/src/features/gifts/GiftForm.tsx, webapp/src/features/gifts/model.ts (or a focused helper alongside it), webapp/tests/gifts-model.test.ts, webapp/e2e/gifts.spec.ts. Existing short harness journey files may be extended if required by the unchanged runner. Do not modify configs, shared contracts, backend, lockfile, release tooling or unrelated features.

- [x] Reproduce exact title+newline+URL failure and add meaningful parser/browser regressions.
- [x] Extract exactly one valid URL from clipboard share text before single-line input strips newlines; suggest title only when blank; preserve query and ordinary URL paste/edit behavior.
- [x] Keep ambiguous/invalid/control-character/credential-bearing inputs rejected and existing required photo behavior intact.
- [x] Run bun test webapp/tests/gifts-model.test.ts and report RED/GREEN evidence: 17 pass / 47 assertions; RED recorded before implementation.
- [x] Run targeted typecheck and the short browser journey: webapp typecheck PASS after generating the ignored Prisma client; one actual clipboard journey PASS. Lead owns final exact-SHA risk gate and publication.

Review focus: clipboard handling on the actual input; preserving manual title; no ambiguity between multiple URLs; no loss of query or ordinary selection/caret semantics; no weakening of server validation. STOP for contract/security/architecture decisions, new network dependencies or any scope expansion.
