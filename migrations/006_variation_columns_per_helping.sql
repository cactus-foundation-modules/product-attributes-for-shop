-- Lets a product use the same attribute for MORE THAN ONE variations column - a
-- boardroom table whose top and edge are both finishes, picked separately per
-- variant, off one shared Finish vocabulary.
--
-- 005 made a product able to hold an attribute twice, but only for its own
-- product-level ticks. Per-variant values stayed keyed by attribute: the column
-- list de-duplicated on attribute id, and writing one variant's value deleted
-- every value of that attribute on that variant first. Two helpings therefore
-- collapsed into one column and one of the two finishes was lost. Hence the rule
-- 005 shipped with, that a repeated attribute could not also be a variations
-- column.
--
-- What changes here is only which rows carry an assignment. 005 deliberately left
-- assignment_id NULL on variant children, because the helping sat on the parent
-- and one attribute meant one column, so the row needed no further identity. Now
-- it does: "Oak on the top" and "Oak on the edge" are the same product, the same
-- value and the same attribute, and the assignment is the only thing telling them
-- apart. So every per-variant row is stamped with the parent helping it belongs
-- to, and the existing UNIQUE (product_id, value_id, assignment_id) starts doing
-- real work for variants instead of collapsing them.
--
-- No DDL is needed: assignment_id, its foreign key and that constraint all
-- arrived in 005. This is the backfill that gives existing installs the same
-- shape a fresh one now writes from the start, which is why 001 needs no edit.

-- shop-variations is an optional companion, so its tables may not exist. A site
-- without it has no variant children and nothing to backfill.
DO $$
BEGIN
    IF to_regclass('public.svr_variants') IS NULL THEN
        RETURN;
    END IF;

    -- Point each variant child's tick at the parent helping it came from. Before
    -- this file at most one helping per attribute could be a variations column,
    -- so for the rows this actually backfills the match is unambiguous; the
    -- ORDER BY only decides the tie this file itself makes possible, and settling
    -- it the same way every run keeps a re-run a no-op rather than a shuffle.
    --
    -- A row whose parent no longer uses that attribute for variations matches
    -- nothing and stays NULL, where the next save on the Variations tab clears
    -- it - the same as today.
    EXECUTE $sql$
        UPDATE "pat_product_values" pv
        SET "assignment_id" = (
            SELECT ppa."id"
            FROM "pat_product_attributes" ppa
            JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
            JOIN "svr_variants" sv ON sv."child_product_id" = pv."product_id"
            WHERE ppa."product_id" = sv."product_id"
              AND ppa."attribute_id" = av."attribute_id"
              AND ppa."use_for_variations" = true
            ORDER BY ppa."position" ASC, ppa."id" ASC
            LIMIT 1
        )
        WHERE pv."assignment_id" IS NULL
          AND EXISTS (
            SELECT 1
            FROM "pat_product_attributes" ppa
            JOIN "pat_attribute_values" av ON av."id" = pv."value_id"
            JOIN "svr_variants" sv ON sv."child_product_id" = pv."product_id"
            WHERE ppa."product_id" = sv."product_id"
              AND ppa."attribute_id" = av."attribute_id"
              AND ppa."use_for_variations" = true
          )
    $sql$;
END $$;
