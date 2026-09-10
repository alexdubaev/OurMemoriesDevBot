-- Block 08: legacy child records remain readable while new onboarding supplies these fields.
ALTER TABLE "children" ADD COLUMN "sex" TEXT;
ALTER TABLE "children" ADD COLUMN "avatar_crop" JSONB;
