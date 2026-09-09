-- Telegram is the only public identity source in the MVP. Existing password users remain
-- readable during the migration, but a Telegram user does not receive a fabricated email.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

CREATE TYPE "external_identity_provider" AS ENUM ('telegram');
CREATE TYPE "family_role" AS ENUM ('full', 'viewer');
CREATE TYPE "family_status" AS ENUM ('active', 'deleting', 'deleted');

CREATE TABLE "external_identities" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "provider" "external_identity_provider" NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "external_identities_subject_check" CHECK ("subject" ~ '^[1-9][0-9]*$')
);

CREATE TABLE "telegram_auth_replays" (
    "fingerprint_hash" TEXT NOT NULL,
    "session_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_auth_replays_pkey" PRIMARY KEY ("fingerprint_hash"),
    CONSTRAINT "telegram_auth_replays_fingerprint_hash_check" CHECK (length("fingerprint_hash") = 64)
);

CREATE TABLE "pilot_admissions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "external_identity_provider" NOT NULL,
    "subject" TEXT NOT NULL,
    "admitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pilot_admissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pilot_admissions_subject_check" CHECK ("subject" ~ '^[1-9][0-9]*$')
);

CREATE TABLE "families" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "family_status" NOT NULL DEFAULT 'active',
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "storage_reserved_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "families_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "families_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "families_storage_bytes_check" CHECK ("storage_used_bytes" >= 0 AND "storage_reserved_bytes" >= 0),
    CONSTRAINT "families_owner_pair_key" UNIQUE ("id", "owner_user_id")
);

CREATE TABLE "family_members" (
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "family_role" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "family_members_pkey" PRIMARY KEY ("family_id", "user_id")
);

CREATE TABLE "children" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "birth_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "children_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "children_display_name_check" CHECK (char_length("display_name") BETWEEN 1 AND 60),
    CONSTRAINT "children_birth_date_check" CHECK ("birth_date" IS NULL OR "birth_date" <= CURRENT_DATE)
);

CREATE TABLE "family_invites" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "role" "family_role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID NOT NULL,
    "accepted_by" UUID,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "family_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "family_invites_token_hash_check" CHECK (length("token_hash") = 64),
    CONSTRAINT "family_invites_acceptance_check" CHECK (("accepted_by" IS NULL) = ("accepted_at" IS NULL))
);

CREATE UNIQUE INDEX "external_identities_provider_subject_key" ON "external_identities"("provider", "subject");
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");
CREATE INDEX "telegram_auth_replays_expires_at_idx" ON "telegram_auth_replays"("expires_at");
CREATE UNIQUE INDEX "pilot_admissions_provider_subject_key" ON "pilot_admissions"("provider", "subject");
CREATE INDEX "pilot_admissions_revoked_at_idx" ON "pilot_admissions"("revoked_at");
CREATE INDEX "families_owner_user_id_idx" ON "families"("owner_user_id");
CREATE INDEX "family_members_user_id_revoked_at_idx" ON "family_members"("user_id", "revoked_at");
CREATE UNIQUE INDEX "family_members_one_active_family_per_user_key" ON "family_members"("user_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "children_family_id_idx" ON "children"("family_id");
CREATE UNIQUE INDEX "family_invites_token_hash_key" ON "family_invites"("token_hash");
CREATE INDEX "family_invites_family_id_expires_at_idx" ON "family_invites"("family_id", "expires_at");

ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "telegram_auth_replays" ADD CONSTRAINT "telegram_auth_replays_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "families" ADD CONSTRAINT "families_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "children" ADD CONSTRAINT "children_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The family and its owner membership are inserted in one transaction. Deferring this composite
-- key keeps that transaction possible while ensuring the pointer can never reference a non-member.
ALTER TABLE "families" ADD CONSTRAINT "families_owner_membership_fkey"
    FOREIGN KEY ("id", "owner_user_id") REFERENCES "family_members"("family_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION "check_active_full_family_owner"() RETURNS trigger AS $$
DECLARE
    target_family UUID;
BEGIN
    IF TG_TABLE_NAME = 'families' THEN
        target_family := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
    ELSE
        target_family := CASE WHEN TG_OP = 'DELETE' THEN OLD."family_id" ELSE NEW."family_id" END;
    END IF;
    IF EXISTS (SELECT 1 FROM "families" WHERE "id" = target_family)
       AND NOT EXISTS (
           SELECT 1
           FROM "families" f
           JOIN "family_members" m ON m."family_id" = f."id" AND m."user_id" = f."owner_user_id"
           WHERE f."id" = target_family AND m."role" = 'full' AND m."revoked_at" IS NULL
       ) THEN
        RAISE EXCEPTION 'family owner must be an active full member' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "families_active_full_owner_check"
AFTER INSERT OR UPDATE OF "owner_user_id" ON "families"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_active_full_family_owner"();

CREATE CONSTRAINT TRIGGER "family_members_active_full_owner_check"
AFTER INSERT OR UPDATE OR DELETE ON "family_members"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_active_full_family_owner"();
