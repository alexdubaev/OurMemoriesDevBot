-- Block 03: provider-neutral private media metadata and quota reservations.

CREATE TYPE "media_source_kind" AS ENUM ('upload', 'telegram');
CREATE TYPE "media_asset_purpose" AS ENUM ('memory', 'child_avatar');
CREATE TYPE "media_asset_kind" AS ENUM ('photo', 'video', 'voice');
CREATE TYPE "media_original_status" AS ENUM ('pending', 'stored', 'failed');
CREATE TYPE "media_rendition_status" AS ENUM ('pending', 'ready', 'failed');
CREATE TYPE "media_variant_kind" AS ENUM ('preview', 'display', 'playback');

ALTER TABLE "families" ADD CONSTRAINT "families_storage_counters_nonnegative"
  CHECK ("storage_used_bytes" >= 0 AND "storage_reserved_bytes" >= 0);

CREATE TABLE "media_assets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "source_kind" "media_source_kind" NOT NULL,
    "purpose" "media_asset_purpose" NOT NULL,
    "media_kind" "media_asset_kind" NOT NULL,
    "original_key" TEXT NOT NULL,
    "declared_mime" TEXT NOT NULL,
    "verified_mime" TEXT,
    "sha256" TEXT,
    "byte_size" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "original_status" "media_original_status" NOT NULL DEFAULT 'pending',
    "rendition_status" "media_rendition_status" NOT NULL DEFAULT 'pending',
    "deleted_at" TIMESTAMPTZ(6),
    "storage_deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_assets_byte_size_positive" CHECK ("byte_size" > 0),
    CONSTRAINT "media_assets_dimensions_positive" CHECK (
      ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
      AND ("duration_ms" IS NULL OR "duration_ms" > 0)
    ),
    CONSTRAINT "media_assets_sha256_format" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_assets_stored_metadata" CHECK (
      "original_status" <> 'stored' OR ("verified_mime" IS NOT NULL AND "sha256" IS NOT NULL)
    ),
    CONSTRAINT "media_assets_child_avatar_photo" CHECK (
      "purpose" <> 'child_avatar' OR "media_kind" = 'photo'
    ),
    CONSTRAINT "media_assets_storage_delete_order" CHECK (
      "storage_deleted_at" IS NULL OR "deleted_at" IS NOT NULL
    )
);

CREATE TABLE "media_variants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "variant" "media_variant_kind" NOT NULL,
    "object_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_variants_byte_size_positive" CHECK ("byte_size" > 0),
    CONSTRAINT "media_variants_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "media_variants_dimensions_positive" CHECK (
      ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)
      AND ("duration_ms" IS NULL OR "duration_ms" > 0)
    )
);

CREATE TABLE "upload_reservations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "bytes" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "finalized_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upload_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "upload_reservations_bytes_positive" CHECK ("bytes" > 0),
    CONSTRAINT "upload_reservations_finalize_released" CHECK (
      "finalized_at" IS NULL OR "released_at" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "media_assets_original_key_key" ON "media_assets"("original_key");
CREATE UNIQUE INDEX "media_assets_id_family_id_key" ON "media_assets"("id", "family_id");
CREATE INDEX "media_assets_family_status_idx" ON "media_assets"("family_id", "original_status", "deleted_at");
CREATE UNIQUE INDEX "media_variants_object_key_key" ON "media_variants"("object_key");
CREATE UNIQUE INDEX "media_variants_media_id_variant_key" ON "media_variants"("media_id", "variant");
CREATE INDEX "media_variants_family_id_media_id_idx" ON "media_variants"("family_id", "media_id");
CREATE UNIQUE INDEX "upload_reservations_media_id_family_id_key" ON "upload_reservations"("media_id", "family_id");
CREATE INDEX "upload_reservations_family_expires_idx" ON "upload_reservations"("family_id", "expires_at");

ALTER TABLE "children" ADD COLUMN "avatar_media_id" UUID;
CREATE UNIQUE INDEX "children_avatar_media_id_key" ON "children"("avatar_media_id");

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_id_fkey"
  FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_membership_fkey"
  FOREIGN KEY ("family_id", "uploader_id") REFERENCES "family_members"("family_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_family_id_fkey"
  FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upload_reservations" ADD CONSTRAINT "upload_reservations_family_id_fkey"
  FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upload_reservations" ADD CONSTRAINT "upload_reservations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upload_reservations" ADD CONSTRAINT "upload_reservations_membership_fkey"
  FOREIGN KEY ("family_id", "user_id") REFERENCES "family_members"("family_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upload_reservations" ADD CONSTRAINT "upload_reservations_media_id_family_id_fkey"
  FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "children" ADD CONSTRAINT "children_avatar_media_id_family_id_fkey"
  FOREIGN KEY ("avatar_media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memory_media" ADD CONSTRAINT "memory_media_media_id_family_id_fkey"
  FOREIGN KEY ("media_id", "family_id") REFERENCES "media_assets"("id", "family_id") ON DELETE RESTRICT ON UPDATE CASCADE;
