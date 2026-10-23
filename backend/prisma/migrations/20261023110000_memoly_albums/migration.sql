CREATE TYPE "album_kind" AS ENUM ('year', 'events', 'workshop', 'free');
CREATE TYPE "album_entry_kind" AS ENUM ('month', 'event', 'work');
CREATE TYPE "album_date_precision" AS ENUM ('day', 'month', 'year', 'unknown');
CREATE TYPE "album_entry_source_kind" AS ENUM ('memory', 'private_storage', 'max_video', 'telegram_video');
CREATE TYPE "album_source_media_kind" AS ENUM ('photo', 'video', 'voice', 'note');

CREATE TABLE "albums" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "child_id" UUID,
    "kind" "album_kind" NOT NULL,
    "template_version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cover_source_id" UUID,
    "create_actor_id" UUID NOT NULL,
    "create_operation" TEXT NOT NULL,
    "create_request_id" UUID NOT NULL,
    "initial_payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "albums_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "albums_kind_child_check" CHECK (("kind" = 'free' AND "child_id" IS NULL) OR ("kind" <> 'free' AND "child_id" IS NOT NULL)),
    CONSTRAINT "albums_version_check" CHECK ("version" > 0 AND "template_version" > 0)
);
CREATE UNIQUE INDEX "albums_id_family_id_key" ON "albums"("id", "family_id");
CREATE UNIQUE INDEX "albums_cover_source_id_key" ON "albums"("cover_source_id");
CREATE UNIQUE INDEX "albums_create_marker_key" ON "albums"("family_id", "create_actor_id", "create_operation", "create_request_id");
CREATE INDEX "albums_family_catalog_idx" ON "albums"("family_id", "kind", "deleted_at", "created_at" DESC, "id" DESC);
ALTER TABLE "albums" ADD CONSTRAINT "albums_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "albums" ADD CONSTRAINT "albums_child_id_family_id_fkey" FOREIGN KEY ("child_id", "family_id") REFERENCES "children"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "album_entries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "kind" "album_entry_kind" NOT NULL,
    "month_number" INTEGER,
    "title" TEXT,
    "caption" TEXT,
    "child_quote" TEXT,
    "category" TEXT,
    "date_value" TEXT,
    "date_precision" "album_date_precision" NOT NULL DEFAULT 'unknown',
    "order_key" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "create_actor_id" UUID,
    "create_operation" TEXT,
    "create_request_id" UUID,
    "initial_payload_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "album_entries_month_check" CHECK (("kind" = 'month' AND "month_number" BETWEEN 1 AND 12) OR ("kind" <> 'month' AND "month_number" IS NULL)),
    CONSTRAINT "album_entries_version_check" CHECK ("version" > 0),
    CONSTRAINT "album_entries_date_check" CHECK (
      ("date_precision" = 'unknown' AND "date_value" IS NULL) OR
      ("date_precision" = 'year' AND "date_value" ~ '^[0-9]{4}$') OR
      ("date_precision" = 'month' AND "date_value" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') OR
      ("date_precision" = 'day' AND "date_value" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND to_char(to_date("date_value", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "date_value")
    )
);
CREATE UNIQUE INDEX "album_entries_id_family_id_key" ON "album_entries"("id", "family_id");
CREATE UNIQUE INDEX "album_entries_id_album_id_family_id_key" ON "album_entries"("id", "album_id", "family_id");
CREATE UNIQUE INDEX "album_entries_album_month_key" ON "album_entries"("album_id", "month_number");
CREATE UNIQUE INDEX "album_entries_create_marker_key" ON "album_entries"("family_id", "create_actor_id", "create_operation", "create_request_id");
CREATE INDEX "album_entries_album_order_idx" ON "album_entries"("family_id", "album_id", "order_key", "id");
ALTER TABLE "album_entries" ADD CONSTRAINT "album_entries_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entries" ADD CONSTRAINT "album_entries_album_id_family_id_fkey" FOREIGN KEY ("album_id", "family_id") REFERENCES "albums"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "album_entry_sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "album_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "source_kind" "album_entry_source_kind" NOT NULL,
    "kind" "album_source_media_kind" NOT NULL,
    "source_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "album_entry_sources_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "album_entry_sources_position_check" CHECK ("position" >= 0)
);
CREATE UNIQUE INDEX "album_entry_sources_id_album_id_family_id_key" ON "album_entry_sources"("id", "album_id", "family_id");
CREATE UNIQUE INDEX "album_entry_sources_entry_source_key" ON "album_entry_sources"("entry_id", "memory_id", "source_kind", "source_id");
CREATE INDEX "album_entry_sources_entry_order_idx" ON "album_entry_sources"("family_id", "album_id", "entry_id", "position");
CREATE INDEX "album_entry_sources_memory_idx" ON "album_entry_sources"("family_id", "memory_id");
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_album_id_family_id_fkey" FOREIGN KEY ("album_id", "family_id") REFERENCES "albums"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_entry_id_album_id_family_id_fkey" FOREIGN KEY ("entry_id", "album_id", "family_id") REFERENCES "album_entries"("id", "album_id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "album_entry_sources" ADD CONSTRAINT "album_entry_sources_memory_id_family_id_fkey" FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "albums" ADD CONSTRAINT "albums_cover_source_id_fkey" FOREIGN KEY ("cover_source_id") REFERENCES "album_entry_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
