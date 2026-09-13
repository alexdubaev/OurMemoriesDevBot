-- Telegram-origin videos remain in Telegram. This table holds only the encrypted Bot API file
-- reference and real metadata; it intentionally has no object key, hash, byte size or variant.
CREATE UNIQUE INDEX "telegram_sources_id_family_id_key" ON "telegram_sources"("id", "family_id");

CREATE TABLE "telegram_video_references" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source_id" UUID NOT NULL,
    "memory_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "file_id_ciphertext" BYTEA NOT NULL,
    "encryption_iv" BYTEA NOT NULL,
    "encryption_auth_tag" BYTEA NOT NULL,
    "file_unique_id" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_video_references_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_video_references_source_id_key" UNIQUE ("source_id"),
    CONSTRAINT "telegram_video_references_memory_id_key" UNIQUE ("memory_id"),
    CONSTRAINT "telegram_video_references_source_id_family_id_key" UNIQUE ("source_id", "family_id"),
    CONSTRAINT "telegram_video_references_memory_id_family_id_key" UNIQUE ("memory_id", "family_id"),
    CONSTRAINT "telegram_video_references_source_id_family_id_fkey"
      FOREIGN KEY ("source_id", "family_id") REFERENCES "telegram_sources"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "telegram_video_references_memory_id_family_id_fkey"
      FOREIGN KEY ("memory_id", "family_id") REFERENCES "memories"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "telegram_video_references_family_id_idx" ON "telegram_video_references"("family_id");

CREATE TABLE "telegram_video_deliveries" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "token_hash" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_video_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "telegram_video_deliveries_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "telegram_video_deliveries_reference_id_fkey"
      FOREIGN KEY ("reference_id") REFERENCES "telegram_video_references"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "telegram_video_deliveries_member_expiry_idx"
  ON "telegram_video_deliveries"("family_id", "user_id", "expires_at");
