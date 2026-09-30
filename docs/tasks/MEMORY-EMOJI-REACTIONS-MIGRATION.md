# MEMORY-EMOJI-REACTIONS migration notes

Migration `20261001090000_memory_reactions` adds the PostgreSQL `memory_reaction` enum and a non-null `memory_likes.reaction` column with default `heart`. PostgreSQL backfills existing rows using that default; the existing `(memory_id, user_id)` primary key, `created_at`, family/member references, and row count are preserved. It creates no additional rows.

The change is additive and can be deployed before reaction-aware application code. On application rollback, keep the enum and column in place: the previous like implementation can continue using the existing table and primary key, while new reaction values remain stored. Do not remove the column or enum during rollback because that would discard non-heart reactions. A later contract migration can be considered only after all deployed code reads the legacy heart-compatible state and there is an explicit data-retention decision.
