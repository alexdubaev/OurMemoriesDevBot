CREATE TYPE "control_user_state" AS ENUM ('active', 'trashed', 'purging', 'purged');

ALTER TABLE "users"
  ADD COLUMN "control_state" "control_user_state" NOT NULL DEFAULT 'active',
  ADD COLUMN "control_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "families"
  ADD COLUMN "control_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "control_user_deletions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "target_user_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6) NOT NULL,
  "purge_after" TIMESTAMPTZ(6) NOT NULL,
  "restored_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_user_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "control_user_deletions_purge_after_check"
    CHECK ("purge_after" = to_timestamp(extract(epoch FROM "deleted_at") + 2592000))
);
CREATE INDEX "control_user_deletions_target_deleted_idx"
  ON "control_user_deletions"("target_user_id", "deleted_at" DESC);
CREATE INDEX "control_user_deletions_purge_idx"
  ON "control_user_deletions"("purge_after", "restored_at");

CREATE TABLE "control_user_deletion_families" (
  "deletion_id" UUID NOT NULL,
  "family_id" UUID NOT NULL,
  "original_status" "family_status" NOT NULL,
  "restore_eligible" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "control_user_deletion_families_pkey" PRIMARY KEY ("deletion_id", "family_id"),
  CONSTRAINT "control_user_deletion_families_deletion_id_fkey"
    FOREIGN KEY ("deletion_id") REFERENCES "control_user_deletions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "control_user_deletion_families_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "control_user_deletion_families_family_id_idx"
  ON "control_user_deletion_families"("family_id");

CREATE TABLE "control_family_deletions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "family_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_family_deletions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "control_family_deletions_family_id_key" UNIQUE ("family_id")
);

CREATE TABLE "control_lifecycle_commands" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "actor_user_id" UUID NOT NULL,
  "key" UUID NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "target_id" UUID NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "response" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_lifecycle_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "control_lifecycle_commands_actor_key_key" UNIQUE ("actor_user_id", "key")
);
CREATE INDEX "control_lifecycle_commands_target_created_idx"
  ON "control_lifecycle_commands"("target_id", "created_at");

CREATE TABLE "control_access_snapshots" (
  "family_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "deletion_id" UUID NOT NULL,
  "role" "family_role" NOT NULL,
  "expected_revoked_version" INTEGER NOT NULL,
  "expected_revoked_epoch" INTEGER NOT NULL,
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "control_access_snapshots_pkey" PRIMARY KEY ("family_id", "user_id"),
  CONSTRAINT "control_access_snapshots_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "control_access_snapshots_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "control_access_snapshots_expected_version_check" CHECK ("expected_revoked_version" > 0),
  CONSTRAINT "control_access_snapshots_expected_epoch_check" CHECK ("expected_revoked_epoch" > 0)
);
CREATE INDEX "control_access_snapshots_deletion_id_idx"
  ON "control_access_snapshots"("deletion_id");

CREATE FUNCTION "control_require_active_session_user"() RETURNS trigger AS $$
DECLARE state "control_user_state";
BEGIN
  IF NEW."revoked_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT "control_state" INTO state
    FROM "users" WHERE "id" = NEW."user_id" FOR UPDATE;
  IF state IS DISTINCT FROM 'active'::"control_user_state" THEN
    RAISE EXCEPTION 'live authentication session requires an active user'
      USING ERRCODE = '23514', CONSTRAINT = 'auth_sessions_active_control_user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "auth_sessions_require_active_control_user"
  BEFORE INSERT OR UPDATE OF "user_id", "revoked_at" ON "auth_sessions"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_session_user"();

CREATE FUNCTION "control_require_active_family_owner"() RETURNS trigger AS $$
DECLARE state "control_user_state";
BEGIN
  SELECT "control_state" INTO state
    FROM "users" WHERE "id" = NEW."owner_user_id" FOR UPDATE;
  IF state IS DISTINCT FROM 'active'::"control_user_state" THEN
    RAISE EXCEPTION 'family owner must be active'
      USING ERRCODE = '23514', CONSTRAINT = 'families_active_control_owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "families_require_active_control_owner"
  BEFORE INSERT OR UPDATE OF "owner_user_id" ON "families"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_family_owner"();

CREATE FUNCTION "control_require_active_family_member_user"() RETURNS trigger AS $$
DECLARE state "control_user_state";
BEGIN
  IF NEW."revoked_at" IS NULL THEN
    SELECT "control_state" INTO state
      FROM "users" WHERE "id" = NEW."user_id" FOR UPDATE;
    IF state IS DISTINCT FROM 'active'::"control_user_state" THEN
      RAISE EXCEPTION 'live family access requires an active user'
        USING ERRCODE = '23514', CONSTRAINT = 'family_members_active_control_user';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "families" WHERE "id" = NEW."family_id" AND "status" = 'active'
    ) THEN
      RAISE EXCEPTION 'live family access requires an active family'
        USING ERRCODE = '23514', CONSTRAINT = 'family_members_active_family';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "family_members_require_active_control_user"
  BEFORE INSERT OR UPDATE OF "user_id", "revoked_at" ON "family_members"
  FOR EACH ROW EXECUTE FUNCTION "control_require_active_family_member_user"();

CREATE OR REPLACE FUNCTION "retire_family_access"() RETURNS trigger AS $$
DECLARE restore_cycle UUID;
BEGIN
  IF OLD."status" <> 'active' AND NEW."status" = 'active' THEN
    BEGIN
      restore_cycle := NULLIF(current_setting('app.control_user_restore_cycle', true), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      restore_cycle := NULL;
    END;
    IF restore_cycle IS NULL OR NOT EXISTS (
      SELECT 1
        FROM "control_user_deletion_families" link
        JOIN "control_user_deletions" deletion ON deletion."id" = link."deletion_id"
        JOIN "users" owner ON owner."id" = deletion."target_user_id"
       WHERE link."deletion_id" = restore_cycle
         AND link."family_id" = NEW."id"
         AND link."restore_eligible"
         AND NEW."owner_user_id" = deletion."target_user_id"
         AND deletion."restored_at" IS NOT NULL
         AND deletion."purge_after" > CURRENT_TIMESTAMP
         AND owner."control_state" = 'active'
    ) THEN
      RAISE EXCEPTION 'an inactive family cannot be reactivated' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD."status" = 'active' AND NEW."status" <> 'active' THEN
    UPDATE "family_members"
       SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP)
     WHERE "family_id" = NEW."id";
    UPDATE "family_invites"
       SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP),
           "updated_at" = CURRENT_TIMESTAMP
     WHERE "family_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
