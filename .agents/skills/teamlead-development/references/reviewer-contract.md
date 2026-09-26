# Reviewer contract

The reviewer is read-only, must be fresh, and should not receive implementer reasoning. Treat `reviewer` as a behavioral contract; use only an available agent authorized by the applicable repository policy.

Supply:
- original user/spec requirements
- BASE SHA and current HEAD
- active diff or exact range
- relevant risk checklist for the change
- verification commands

Review P0/P1/P2 correctness first. Ignore style-only preferences unless they hide a real bug. Return findings with evidence; do not edit files, add coverage, or apply fixes.

The lead adjudicates and may resolve bounded safe findings when repository policy permits. After one permitted fix pass, perform one narrow recheck of the findings. Escalate architectural, security/ACL, data-model, migration, production-data, and complex race/idempotency decisions. Do not start repeated full review/fix loops unless the user or repository policy explicitly requires them.
