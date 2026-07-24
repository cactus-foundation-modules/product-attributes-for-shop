-- Specification sections: lets a product show a chosen set of its attributes on
-- the public product page's Specification tab, sorted into headed groups
-- ("Mechanisms", "Guarantee") of the owner's own making.
--
-- Two new ideas, both PER PRODUCT rather than shop-wide - deliberately unlike
-- pat_attribute_groups, which sorts the vocabulary in admin and never reaches a
-- shopper. The same attribute can sit in "Mechanisms" on one chair and go
-- unshown on the next, so the placement belongs to the helping, not the
-- attribute:
--
--   1. pat_product_attributes grows three columns. show_in_spec decides whether
--      the helping appears on the product page at all; spec_section_id says which
--      of this product's sections it sits under (NULL = the unsectioned run shown
--      before the first heading); spec_position orders it within that run.
--
--   2. pat_product_spec_sections holds a product's own section headings, in
--      order. Deleting one tips its attributes back into the unsectioned run
--      rather than hiding them (ON DELETE SET NULL below), the same courtesy
--      pat_attributes/group_id extends.
--
-- All DDL is idempotent; existing installs pick it up on their next deploy, and a
-- fresh install gets the same shape from 001 having never known otherwise.

-- 1. The product's section headings ------------------------------------------

CREATE TABLE IF NOT EXISTS "pat_product_spec_sections" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pat_product_spec_sections_pkey" PRIMARY KEY ("id")
);

-- A section belongs to one product and goes when the product goes.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_spec_sections_product_id_fkey'
    ) THEN
        ALTER TABLE "pat_product_spec_sections"
            ADD CONSTRAINT "pat_product_spec_sections_product_id_fkey"
            FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pat_product_spec_sections_product_id_position_idx"
    ON "pat_product_spec_sections" ("product_id", "position");

-- 2. Per-helping specification flags -----------------------------------------

ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "show_in_spec" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "spec_section_id" TEXT;
ALTER TABLE "pat_product_attributes" ADD COLUMN IF NOT EXISTS "spec_position" INTEGER NOT NULL DEFAULT 0;

-- ON DELETE SET NULL, not CASCADE: deleting a section must tip its attributes
-- back into the unsectioned run, never remove them from the product.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pat_product_attributes_spec_section_id_fkey'
    ) THEN
        ALTER TABLE "pat_product_attributes"
            ADD CONSTRAINT "pat_product_attributes_spec_section_id_fkey"
            FOREIGN KEY ("spec_section_id") REFERENCES "pat_product_spec_sections"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pat_product_attributes_spec_section_id_idx"
    ON "pat_product_attributes" ("spec_section_id");
