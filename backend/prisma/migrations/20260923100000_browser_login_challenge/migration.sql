CREATE TYPE "browser_login_challenge_state" AS ENUM ('pending', 'approved', 'redeemed');

CREATE TABLE "browser_login_challenges" (
    "id" TEXT NOT NULL,
    "verifier_hash" TEXT NOT NULL,
    "display_code_hash" TEXT NOT NULL,
    "state" "browser_login_challenge_state" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "approved_at" TIMESTAMPTZ(6),
    "approved_user_id" UUID,
    "approved_external_identity_id" UUID,
    "redeemed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "browser_login_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "browser_login_challenges_verifier_hash_key"
ON "browser_login_challenges"("verifier_hash");

CREATE INDEX "browser_login_challenges_state_expires_idx"
ON "browser_login_challenges"("state", "expires_at");

ALTER TABLE "browser_login_challenges"
ADD CONSTRAINT "browser_login_challenges_approved_user_id_fkey"
FOREIGN KEY ("approved_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "browser_login_challenges"
ADD CONSTRAINT "browser_login_challenges_approved_identity_id_fkey"
FOREIGN KEY ("approved_external_identity_id") REFERENCES "external_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
