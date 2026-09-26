-- The new one-undeleted-owned-family index remains authoritative. Writers keep the
-- legacy single-membership policy when the server activation gate is off.
DROP INDEX "family_members_one_active_family_per_user_key";
