-- A record of the attributes an owner has taken OFF a product's variations.
--
-- A plain column heading on the Google Sheet's variations tab attaches the
-- attribute it names to that product (see lib/variant-field-provider.ts). That
-- is what the owner asked for, and on its own it is a trap: the attached column
-- goes straight back into the sheet on the next Push, so removing it on the
-- product's Attributes tab lasted exactly until the next Pull put it back. That
-- loop is why sheet auto-attach was taken out in v0.1.35.
--
-- So the sheet proposes and the owner disposes: taking a variation helping off a
-- product records the pair here, and nothing attaches that attribute to that
-- product from a heading again. Re-adding it by hand in the admin clears the
-- block, because that is the owner saying yes rather than the sheet saying it
-- for them.
--
-- Deliberately NOT keyed on the helping id: the id changes every time the
-- attribute is re-added, and what is being remembered is a decision about a
-- (product, attribute) pair, not about a row.
CREATE TABLE IF NOT EXISTS "pat_variation_attach_blocks" (
    "product_id" TEXT NOT NULL,
    "attribute_id" TEXT NOT NULL,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pat_variation_attach_blocks_pkey" PRIMARY KEY ("product_id", "attribute_id"),
    CONSTRAINT "pat_variation_attach_blocks_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "pat_variation_attach_blocks_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "pat_attributes"("id") ON DELETE CASCADE
);

-- The read is always "is this one pair blocked?", which the primary key already
-- answers. The index is for the clear-up when an attribute is deleted outright.
CREATE INDEX IF NOT EXISTS "pat_variation_attach_blocks_attribute_id_idx"
    ON "pat_variation_attach_blocks" ("attribute_id");
