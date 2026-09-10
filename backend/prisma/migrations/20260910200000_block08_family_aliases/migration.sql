-- Block 08: family-local display names stay separate from global user profiles and access roles.

ALTER TABLE "family_members" ADD COLUMN "family_display_name" TEXT;
ALTER TABLE "family_invites" ADD COLUMN "invitee_display_name" TEXT;
