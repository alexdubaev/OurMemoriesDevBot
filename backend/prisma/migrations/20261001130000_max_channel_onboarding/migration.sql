CREATE TABLE "max_channel_bindings" (
  "chat_id" BIGINT NOT NULL,
  "family_id" UUID,
  "title" TEXT,
  "state" TEXT NOT NULL DEFAULT 'disconnected',
  "version" INTEGER NOT NULL DEFAULT 1,
  "last_lifecycle_at" TIMESTAMPTZ(6),
  "last_provider_check_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "max_channel_bindings_pkey" PRIMARY KEY ("chat_id"),
  CONSTRAINT "max_channel_bindings_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "max_channel_bindings_family_state_idx" ON "max_channel_bindings"("family_id", "state");

-- Preserve every currently routable signed channel ID before lifecycle state is enabled.
INSERT INTO "max_channel_bindings" ("chat_id", "family_id", "title", "state", "version", "updated_at")
SELECT "max_backup_chat_id", "id", NULL, 'connected', 1, CURRENT_TIMESTAMP
FROM "families" WHERE "max_backup_chat_id" IS NOT NULL
ON CONFLICT ("chat_id") DO NOTHING;

CREATE TABLE "max_channel_decisions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "origin_inbox_id" UUID NOT NULL,
  "actor_subject" TEXT NOT NULL,
  "actor_user_id" UUID,
  "chat_id" BIGINT NOT NULL,
  "candidate_family_ids" JSONB NOT NULL,
  "phase" TEXT NOT NULL DEFAULT 'select_family',
  "selected_family_id" UUID,
  "expected_active_chat_id" BIGINT,
  "expected_active_version" INTEGER NOT NULL,
  "expected_channel_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "max_channel_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "max_channel_decisions_origin_inbox_id_key" UNIQUE ("origin_inbox_id"),
  CONSTRAINT "max_channel_decisions_origin_inbox_id_fkey" FOREIGN KEY ("origin_inbox_id") REFERENCES "max_inbox"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "max_channel_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "max_channel_decisions_actor_status_expiry_idx" ON "max_channel_decisions"("actor_subject", "status", "expires_at");

ALTER TABLE "max_outgoing_responses" ADD COLUMN "channel_decision_id" UUID;
ALTER TABLE "max_outgoing_responses" ADD COLUMN "buttons" JSONB;
ALTER TABLE "max_outgoing_responses" ADD CONSTRAINT "max_outgoing_responses_channel_decision_id_fkey"
  FOREIGN KEY ("channel_decision_id") REFERENCES "max_channel_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
