-- Expand-only foundation. The existing one-active-membership index and all old writer guards
-- remain in force; neither multiple memberships nor unread tracking is activated here.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM families
     WHERE status <> 'deleted'
     GROUP BY owner_user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple non-deleted families owned by one user; resolve before B1 migration'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE UNIQUE INDEX "families_one_undeleted_owned_family_per_user_key"
  ON "families"("owner_user_id") WHERE "status" <> 'deleted';

ALTER TABLE "families"
  ADD COLUMN "publication_ordinal" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "unread_tracking_activated_at" TIMESTAMPTZ(6),
  ADD CONSTRAINT "families_publication_ordinal_nonnegative" CHECK ("publication_ordinal" >= 0);

ALTER TABLE "family_members"
  ADD COLUMN "membership_epoch" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "unread_baseline_ordinal" BIGINT,
  ADD CONSTRAINT "family_members_membership_epoch_positive" CHECK ("membership_epoch" > 0),
  ADD CONSTRAINT "family_members_unread_baseline_nonnegative" CHECK ("unread_baseline_ordinal" IS NULL OR "unread_baseline_ordinal" >= 0);

ALTER TABLE "memories"
  ADD COLUMN "first_published_ordinal" BIGINT,
  ADD CONSTRAINT "memories_first_published_ordinal_positive" CHECK ("first_published_ordinal" IS NULL OR "first_published_ordinal" > 0);

CREATE UNIQUE INDEX "memories_family_id_first_published_ordinal_key"
  ON "memories"("family_id", "first_published_ordinal");

CREATE TABLE "memory_seen" (
  "family_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "membership_epoch" INTEGER NOT NULL,
  "memory_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_seen_pkey" PRIMARY KEY ("family_id", "user_id", "membership_epoch", "memory_id"),
  CONSTRAINT "memory_seen_membership_epoch_positive" CHECK ("membership_epoch" > 0),
  CONSTRAINT "memory_seen_family_id_user_id_fkey"
    FOREIGN KEY ("family_id", "user_id") REFERENCES "family_members"("family_id", "user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "memory_seen_memory_id_family_id_fkey"
    FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "memory_seen_memory_id_family_id_idx" ON "memory_seen"("memory_id", "family_id");

COMMIT;
