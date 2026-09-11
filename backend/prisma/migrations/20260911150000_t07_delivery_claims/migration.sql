-- A delivery is claimed before the external Bot API call. A claimed pointer is never retried:
-- a lost response is recorded as ambiguous instead of risking a duplicate private video.
ALTER TABLE "telegram_video_deliveries"
  ADD COLUMN "claim_token" UUID,
  ADD COLUMN "claimed_at" TIMESTAMPTZ(6),
  ADD COLUMN "ambiguous_at" TIMESTAMPTZ(6),
  ADD COLUMN "denied_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "telegram_video_deliveries_claim_token_key"
  ON "telegram_video_deliveries"("claim_token");

CREATE INDEX "telegram_video_deliveries_expires_at_idx"
  ON "telegram_video_deliveries"("expires_at");

ALTER TABLE "telegram_video_deliveries"
  ADD CONSTRAINT "telegram_video_deliveries_terminal_state_check"
  CHECK (num_nonnulls("delivered_at", "ambiguous_at", "denied_at") <= 1),
  ADD CONSTRAINT "telegram_video_deliveries_claim_pair_check"
  CHECK (("claim_token" IS NULL) = ("claimed_at" IS NULL));
