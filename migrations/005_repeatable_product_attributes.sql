-- Lets one product use the same attribute more than once, each helping under a
-- name of its own - a desk that is "Top material: Oak" and "Frame material:
-- Steel" without needing two near-identical attributes in the shop's vocabulary.
-- This mirrors what shop-variations already allows on the Variations tab, where
-- a second option off the same source simply has to be called something else.
--
-- Two structural changes make it possible:
--
--   1. pat_product_attributes stops being keyed by (product, attribute) and
--      grows a surrogate id, so a product can hold several rows for the same
--      attribute. name_override carries the name this helping goes by; NULL
--      means "call it whatever the attribute is called".
--
--   2. pat_product_values grows assignment_id, so a ticked value knows which
--      helping it belongs to. Without it, ticking Oak under "Top material" and
--      Oak under "Frame material" would be the same row and the two blocks
--      could never disagree.
--
-- assignment_id is deliberately NULLABLE. Per-variant values live on the hidden
-- child products, where the assignment sits on the parent rather than on the row
-- itself, and those rows carry NULL - as do any rows written before this file
-- ran. Both unique constraints below therefore use NULLS NOT DISTINCT, so a NULL
-- assignment still de-duplicates properly instead of allowing endless copies.
--
-- All DDL is idempotent; existing installs pick it up on their next deploy.

-- 1. Surrogate key + the per-helping name -----------------------------------

ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "name_override" TEXT;
ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "pat_product_attributes" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "pat_product_attributes" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "pat_product_attributes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

DO $$
BEGIN
    -- Swap the composite primary key for the surrogate one. Dropping the old key
    -- is what actually allows the second helping; everything else here is
    -- bookkeeping around it.
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_attributes_pkey') THEN
        ALTER TABLE "pat_product_attributes" DROP CONSTRAINT "pat_product_attributes_pkey";
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_attributes_id_pkey') THEN
        ALTER TABLE "pat_product_attributes" ADD CONSTRAINT "pat_product_attributes_id_pkey" PRIMARY KEY ("id");
    END IF;
    -- One helping per (product, attribute, name). A repeat with no name of its
    -- own collides with the first, which is exactly the rule the editor states
    -- in words: all but one copy needs renaming.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_attributes_named_key') THEN
        ALTER TABLE "pat_product_attributes"
            ADD CONSTRAINT "pat_product_attributes_named_key"
            UNIQUE NULLS NOT DISTINCT ("product_id", "attribute_id", "name_override");
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pat_product_attributes_product_id_idx" ON "pat_product_attributes" ("product_id");

-- 2. Ticked values know which helping they belong to -------------------------

ALTER TABLE "pat_product_values" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "pat_product_values" ADD COLUMN IF NOT EXISTS "assignment_id" TEXT;

UPDATE "pat_product_values" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;

ALTER TABLE "pat_product_values" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "pat_product_values" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;

-- Point every existing product-level tick at the one helping it can only have
-- come from: before this file there was exactly one row per (product,
-- attribute), so the match is unambiguous. Rows on variant child products find
-- no match and stay NULL, which is correct - the assignment lives on the parent.
UPDATE "pat_product_values" pv
SET "assignment_id" = ppa."id"
FROM "pat_attribute_values" av, "pat_product_attributes" ppa
WHERE pv."assignment_id" IS NULL
  AND av."id" = pv."value_id"
  AND ppa."product_id" = pv."product_id"
  AND ppa."attribute_id" = av."attribute_id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_values_pkey') THEN
        ALTER TABLE "pat_product_values" DROP CONSTRAINT "pat_product_values_pkey";
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_values_id_pkey') THEN
        ALTER TABLE "pat_product_values" ADD CONSTRAINT "pat_product_values_id_pkey" PRIMARY KEY ("id");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_values_assignment_key') THEN
        ALTER TABLE "pat_product_values"
            ADD CONSTRAINT "pat_product_values_assignment_key"
            UNIQUE NULLS NOT DISTINCT ("product_id", "value_id", "assignment_id");
    END IF;
    -- Removing a helping takes its ticks with it. Without this, dropping "Frame
    -- material" would leave its values behind, still feeding the storefront
    -- filter from a block nobody can see any more.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_values_assignment_id_fkey') THEN
        ALTER TABLE "pat_product_values"
            ADD CONSTRAINT "pat_product_values_assignment_id_fkey"
            FOREIGN KEY ("assignment_id") REFERENCES "pat_product_attributes"("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pat_product_values_assignment_id_idx" ON "pat_product_values" ("assignment_id");
CREATE INDEX IF NOT EXISTS "pat_product_values_product_id_idx" ON "pat_product_values" ("product_id");
