CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_user_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "idempotency_records_payload_hash_check" CHECK (length("payload_hash") = 64)
);

CREATE UNIQUE INDEX "idempotency_records_actor_operation_key_key"
    ON "idempotency_records"("actor_user_id", "operation", "key");
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An owner is required only while the family is active. Retirement revokes every membership,
-- including the owner, so the previous invariant must explicitly share the service definition
-- of "active family".
CREATE OR REPLACE FUNCTION "check_active_full_family_owner"() RETURNS trigger AS $$
DECLARE
    target_family UUID;
BEGIN
    IF TG_TABLE_NAME = 'families' THEN
        target_family := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
    ELSE
        target_family := CASE WHEN TG_OP = 'DELETE' THEN OLD."family_id" ELSE NEW."family_id" END;
    END IF;
    IF EXISTS (SELECT 1 FROM "families" WHERE "id" = target_family AND "status" = 'active')
       AND NOT EXISTS (
           SELECT 1
           FROM "families" f
           JOIN "family_members" m ON m."family_id" = f."id" AND m."user_id" = f."owner_user_id"
           WHERE f."id" = target_family
             AND f."status" = 'active'
             AND m."role" = 'full'
             AND m."revoked_at" IS NULL
       ) THEN
        RAISE EXCEPTION 'family owner must be an active full member' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "retire_family_access"() RETURNS trigger AS $$
BEGIN
    IF OLD."status" <> 'active' AND NEW."status" = 'active' THEN
        RAISE EXCEPTION 'an inactive family cannot be reactivated' USING ERRCODE = '23514';
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

CREATE TRIGGER "families_retire_access"
AFTER UPDATE OF "status" ON "families"
FOR EACH ROW EXECUTE FUNCTION "retire_family_access"();

CREATE FUNCTION "require_active_family_for_live_access"() RETURNS trigger AS $$
BEGIN
    IF NEW."revoked_at" IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM "families" WHERE "id" = NEW."family_id" AND "status" = 'active'
       ) THEN
        RAISE EXCEPTION 'live family access requires an active family' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "family_members_require_active_family"
BEFORE INSERT OR UPDATE OF "family_id", "revoked_at" ON "family_members"
FOR EACH ROW EXECUTE FUNCTION "require_active_family_for_live_access"();

CREATE TRIGGER "family_invites_require_active_family"
BEFORE INSERT OR UPDATE OF "family_id", "revoked_at" ON "family_invites"
FOR EACH ROW EXECUTE FUNCTION "require_active_family_for_live_access"();
