CREATE TABLE "album_source_operations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_source_operations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "album_source_operations_scope_key"
    ON "album_source_operations"("family_id", "actor_user_id", "album_id", "entry_id", "operation", "request_id");
CREATE INDEX "album_source_operations_entry_idx"
    ON "album_source_operations"("family_id", "album_id", "entry_id");

ALTER TABLE "album_source_operations"
    ADD CONSTRAINT "album_source_operations_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_source_operations"
    ADD CONSTRAINT "album_source_operations_album_id_family_id_fkey"
    FOREIGN KEY ("album_id", "family_id") REFERENCES "albums"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_source_operations"
    ADD CONSTRAINT "album_source_operations_entry_id_album_id_family_id_fkey"
    FOREIGN KEY ("entry_id", "album_id", "family_id") REFERENCES "album_entries"("id", "album_id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_source_operations"
    ADD CONSTRAINT "album_source_operations_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
