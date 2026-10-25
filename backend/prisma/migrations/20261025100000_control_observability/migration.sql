BEGIN;

CREATE TABLE "control_user_activity" (
    "user_id" UUID NOT NULL,
    "utc_day" DATE NOT NULL,
    "first_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "surface" VARCHAR(16) NOT NULL,
    CONSTRAINT "control_user_activity_pkey" PRIMARY KEY ("user_id", "utc_day"),
    CONSTRAINT "control_user_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "control_user_activity_utc_day_idx" ON "control_user_activity"("utc_day");
CREATE INDEX "control_user_activity_last_observed_at_idx" ON "control_user_activity"("last_observed_at");

CREATE TABLE "control_family_activity" (
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "utc_day" DATE NOT NULL,
    "first_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "control_family_activity_pkey" PRIMARY KEY ("family_id", "user_id", "utc_day"),
    CONSTRAINT "control_family_activity_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "control_family_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "control_family_activity_utc_day_idx" ON "control_family_activity"("utc_day");
CREATE INDEX "control_family_activity_last_observed_at_idx" ON "control_family_activity"("last_observed_at");

CREATE TABLE "control_metric_snapshot" (
    "source_id" VARCHAR(80) NOT NULL,
    "utc_day" DATE NOT NULL,
    "value" JSONB,
    "observed_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "status" VARCHAR(32) NOT NULL,
    "error_code" VARCHAR(32),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "control_metric_snapshot_pkey" PRIMARY KEY ("source_id", "utc_day")
);
CREATE INDEX "control_metric_snapshot_utc_day_idx" ON "control_metric_snapshot"("utc_day");

CREATE TABLE "control_collection_state" (
    "id" VARCHAR(80) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "control_collection_state_pkey" PRIMARY KEY ("id")
);

COMMIT;
