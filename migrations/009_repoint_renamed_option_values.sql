-- Data repair: variation option values copied from an attribute, whose label was
-- later renamed without the link moving with it.
--
-- A copy in svr_option_values remembers which pat_attribute_values row it came
-- from in "source_ref". That ref, not the label, is what a "Refresh from source"
-- and this module's own push both match on. A sheet import used to rename a copy
-- and leave the ref where it was, so a copy could read "Black" while still
-- answering to the attribute's "Silver" - and the next edit to Silver's swatch
-- landed on it. That is what turned the Black leg finish grey on eight Impulse
-- desks; the same fault put a Maple picture under a "Beech" finish.
--
-- The importer no longer does that (see rename-repoint.ts in shop-variations).
-- This repairs the copies already written.
--
-- Deliberately conservative: a copy is only re-pointed when its own attribute
-- holds exactly one value with that label and no sibling copy on the same option
-- already claims that value. A copy whose label matches nothing in the attribute
-- (a genuinely bespoke label) is left exactly as it is.
--
-- Idempotent: after it runs there is nothing left for it to match. Guarded on
-- the variations tables, which only exist where shop-variations is installed -
-- hence EXECUTE, so the statement is never parsed on an install without them.

DO $$
BEGIN
  IF to_regclass('public.svr_option_values') IS NULL OR to_regclass('public.svr_options') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $sql$
    WITH drifted AS (
      -- Copies pointing at a value of the right attribute but the wrong name.
      SELECT ov."id",
             ov."option_id",
             ov."label",
             ov."swatch",
             cur."attribute_id",
             cur."swatch" AS "old_swatch"
      FROM "svr_option_values" ov
      JOIN "svr_options" o ON o."id" = ov."option_id" AND o."source_provider" = 'product-attributes'
      JOIN "pat_attribute_values" cur ON cur."id" = ov."source_ref"
      WHERE lower(cur."label") <> lower(ov."label")
    ),
    repointed AS (
      SELECT d."id",
             d."swatch",
             d."old_swatch",
             tgt."id" AS "new_ref",
             tgt."swatch" AS "new_swatch"
      FROM drifted d
      JOIN "pat_attribute_values" tgt
        ON tgt."attribute_id" = d."attribute_id"
       AND lower(tgt."label") = lower(d."label")
      -- One unambiguous target only.
      WHERE (
              SELECT count(*) FROM "pat_attribute_values" c
              WHERE c."attribute_id" = d."attribute_id" AND lower(c."label") = lower(d."label")
            ) = 1
      -- And nothing else on this option is already that value: two copies sharing
      -- one ref is the same ambiguity in a different coat.
        AND NOT EXISTS (
              SELECT 1 FROM "svr_option_values" sib
              WHERE sib."option_id" = d."option_id" AND sib."id" <> d."id" AND sib."source_ref" = tgt."id"
            )
    )
    UPDATE "svr_option_values" ov
    SET "source_ref" = r."new_ref",
        -- Take the newly-linked value's swatch only where the stored one was the
        -- old link's (or absent). A colour or picture the owner set by hand on
        -- the product survives, exactly as the importer now treats it.
        "swatch" = CASE
                     WHEN ov."swatch" IS NULL OR ov."swatch" IS NOT DISTINCT FROM r."old_swatch"
                       THEN r."new_swatch"
                     ELSE ov."swatch"
                   END
    FROM repointed r
    WHERE ov."id" = r."id"
  $sql$;
END $$;
