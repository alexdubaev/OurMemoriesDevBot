ALTER TABLE "control_user_deletions"
  ADD COLUMN "purge_stage" VARCHAR(24) NOT NULL DEFAULT 'waiting',
  ADD COLUMN "purge_cursor" VARCHAR(128),
  ADD COLUMN "purged_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error_code" VARCHAR(48);

ALTER TABLE "control_family_deletions"
  ADD COLUMN "purge_stage" VARCHAR(24) NOT NULL DEFAULT 'capture_media',
  ADD COLUMN "purge_cursor" VARCHAR(128),
  ADD COLUMN "not_before" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "keys_captured_at" TIMESTAMPTZ(6),
  ADD COLUMN "purged_at" TIMESTAMPTZ(6),
  ADD COLUMN "last_error_code" VARCHAR(48);
UPDATE "control_family_deletions"
   SET "not_before" = GREATEST("requested_at" + INTERVAL '16 minutes', CURRENT_TIMESTAMP + INTERVAL '16 minutes');

CREATE TABLE "control_storage_deletes" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "operation_id" UUID NOT NULL,
  "family_id" UUID,
  "user_id" UUID,
  "object_key" TEXT NOT NULL,
  "not_before" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(48),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_storage_deletes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "control_storage_deletes_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "control_storage_deletes_object_key_key" ON "control_storage_deletes"("object_key");
CREATE UNIQUE INDEX "control_storage_deletes_operation_object_key_key" ON "control_storage_deletes"("operation_id", "object_key");
CREATE INDEX "control_storage_deletes_due_idx"
  ON "control_storage_deletes"("operation_id", "completed_at", "next_attempt_at");

-- Existing retention remains the default. Only a matching irreversible operation may cross it,
-- after all source keys have been copied into the independent durable queue.
CREATE OR REPLACE FUNCTION "protect_retained_max_video_asset"() RETURNS trigger AS $$
DECLARE
  operation_id UUID;
BEGIN
  BEGIN
    operation_id := NULLIF(current_setting('app.control_family_purge_operation', true), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    operation_id := NULL;
  END;

  IF operation_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM "control_family_deletions" deletion
      JOIN "families" family ON family."id" = deletion."family_id"
     WHERE deletion."id" = operation_id
       AND deletion."family_id" = OLD."family_id"
       AND deletion."keys_captured_at" IS NOT NULL
       AND family."status" <> 'active'
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF OLD."legacy_video_retained_at" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "max_video_legacy_retention"
     WHERE "media_id" = OLD."id" AND "family_id" = OLD."family_id"
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN NULL;
    END IF;
    IF (OLD."legacy_video_retained_at" IS NOT NULL AND NEW."legacy_video_retained_at" IS NULL)
       OR (OLD."deleted_at" IS NULL AND NEW."deleted_at" IS NOT NULL)
       OR (OLD."storage_deleted_at" IS NULL AND NEW."storage_deleted_at" IS NOT NULL) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- A stale runtime may still approve an old pending challenge after an account is trashed. Treat
-- approval as a live authorization grant and serialize only that transition on its User row;
-- consuming an already-approved challenge must not introduce a reverse lock order.
CREATE FUNCTION "control_require_active_browser_approval"() RETURNS trigger AS $$
DECLARE
  control_state "control_user_state";
BEGIN
  IF NEW."state" = 'approved' AND NEW."approved_user_id" IS NOT NULL AND
     (TG_OP = 'INSERT' OR OLD."state" IS DISTINCT FROM 'approved' OR
      OLD."approved_user_id" IS DISTINCT FROM NEW."approved_user_id") THEN
    SELECT "control_state" INTO control_state
      FROM "users" WHERE "id" = NEW."approved_user_id" FOR NO KEY UPDATE;
    IF control_state IS DISTINCT FROM 'active'::"control_user_state" THEN
      RAISE EXCEPTION 'browser approval requires an active user'
        USING ERRCODE = '23514', CONSTRAINT = 'browser_login_challenges_active_control_user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "browser_login_challenges_require_active_control_user"
  BEFORE INSERT OR UPDATE OF "state", "approved_user_id" ON "browser_login_challenges"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_browser_approval"();
