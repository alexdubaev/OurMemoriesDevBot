CREATE TABLE "caption_requests" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "family_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "memory_id" UUID NOT NULL,
  "chat_id" BIGINT NOT NULL,
  "prompt_message_id" BIGINT NOT NULL,
  "expected_version" INTEGER NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "caption_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "caption_requests_chat_prompt_key" ON "caption_requests"("chat_id", "prompt_message_id");
CREATE INDEX "caption_requests_scope_expiry_idx" ON "caption_requests"("family_id", "user_id", "expires_at");
