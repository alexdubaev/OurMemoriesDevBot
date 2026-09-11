-- A date-only birthday is validated against the family's IANA timezone by FamilyService.
-- CURRENT_DATE uses the database session timezone and rejects a valid family-local "today".
ALTER TABLE "children" DROP CONSTRAINT "children_birth_date_check";
