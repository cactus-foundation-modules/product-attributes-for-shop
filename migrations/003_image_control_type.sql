-- Adds the IMAGE control type: an attribute whose values are offered as picture
-- tiles rather than colour dots, tick boxes or a dropdown.
--
-- No new column. The existing `swatch` column already holds one visual per
-- value; for an IMAGE attribute that visual is a media url rather than a hex
-- colour, exactly as shop-variations does it in svr_option_values.
--
-- Only the CHECK constraint has to move. Dropped and re-added rather than
-- altered in place - Postgres has no ALTER CONSTRAINT for a CHECK - with the
-- DROP made unconditional-safe by IF EXISTS so the file is idempotent.
ALTER TABLE "pat_attributes" DROP CONSTRAINT IF EXISTS "pat_attributes_control_type_check";
ALTER TABLE "pat_attributes" ADD CONSTRAINT "pat_attributes_control_type_check"
    CHECK ("control_type" IN ('CHECKBOX', 'SWATCH', 'DROPDOWN', 'IMAGE'));
