ALTER TABLE "media_assets"
  ADD COLUMN "waveform" JSONB,
  ADD COLUMN "processing_error_code" TEXT;

ALTER TABLE "media_variants"
  ADD COLUMN "codec" TEXT;
