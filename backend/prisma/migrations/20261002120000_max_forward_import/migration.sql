ALTER TABLE "max_sources"
ADD COLUMN "original_message_id" TEXT,
ADD COLUMN "original_channel_id" BIGINT;

CREATE UNIQUE INDEX "max_sources_family_original_channel_message_key"
ON "max_sources"("family_id", "original_channel_id", "original_message_id");
