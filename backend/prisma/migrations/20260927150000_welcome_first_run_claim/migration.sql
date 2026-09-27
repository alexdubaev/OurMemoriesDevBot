-- Existing accounts are returning users. The table lock keeps concurrent inserts
-- outside this transaction, so users created after the backfill retain NULL.
BEGIN;
ALTER TABLE "users" ADD COLUMN "welcome_shown_at" TIMESTAMP(3);
UPDATE "users" SET "welcome_shown_at" = CURRENT_TIMESTAMP WHERE "welcome_shown_at" IS NULL;
COMMIT;
