ALTER TABLE "auth_sessions" ADD COLUMN "external_identity_id" UUID;

CREATE INDEX "auth_sessions_external_identity_id_idx"
    ON "auth_sessions"("external_identity_id");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_external_identity_id_fkey"
    FOREIGN KEY ("external_identity_id") REFERENCES "external_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
