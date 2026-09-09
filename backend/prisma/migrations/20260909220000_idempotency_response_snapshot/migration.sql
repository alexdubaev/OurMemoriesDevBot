ALTER TABLE "idempotency_records"
    ADD COLUMN "response_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The default only makes an already-applied review migration upgrade safely. Every new record
-- must carry the immutable operation result written by the application transaction.
ALTER TABLE "idempotency_records"
    ALTER COLUMN "response_snapshot" DROP DEFAULT;
