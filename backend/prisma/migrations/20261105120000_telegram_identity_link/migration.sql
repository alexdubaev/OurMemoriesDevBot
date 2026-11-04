CREATE TABLE "telegram_identity_links" (
  "source_session_id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  CONSTRAINT "telegram_identity_links_pkey" PRIMARY KEY ("source_session_id"),
  CONSTRAINT "telegram_identity_links_source_session_id_fkey" FOREIGN KEY ("source_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "telegram_identity_links_token_hash_key" ON "telegram_identity_links"("token_hash");
