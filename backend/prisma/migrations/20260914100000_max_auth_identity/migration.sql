ALTER TYPE "external_identity_provider" ADD VALUE 'max';

CREATE TABLE "max_auth_replays" (
    "fingerprint_hash" TEXT NOT NULL,
    "session_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "max_auth_replays_pkey" PRIMARY KEY ("fingerprint_hash"),
    CONSTRAINT "max_auth_replays_fingerprint_hash_check" CHECK (length("fingerprint_hash") = 64)
);

CREATE INDEX "max_auth_replays_expires_at_idx" ON "max_auth_replays"("expires_at");

ALTER TABLE "max_auth_replays" ADD CONSTRAINT "max_auth_replays_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
