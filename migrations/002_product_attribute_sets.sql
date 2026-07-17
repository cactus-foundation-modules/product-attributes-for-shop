-- Adds the product-level "attribute set": which attributes a product uses, and
-- two per-product flags. All DDL is idempotent so this is safe to re-run and is
-- applied to existing installs on their next deploy by run-module-migrations.
--
-- Why a table rather than deriving membership from pat_product_values: a product
-- can be "in the set" before any value is ticked, and the two flags below belong
-- to the (product, attribute) pair, not to any single value.
--
--   use_for_variations - the attribute's value is set per variant (shown as a
--     column on the Variations tab) rather than once for the whole product.
--   show_in_filters    - whether this product's values for the attribute feed the
--     public filter grid. Off keeps the attribute for internal use (e.g. to
--     organise variants) without offering it to shoppers. This is finer than the
--     shop-wide pat_attributes.show_in_filters, which hides an attribute for the
--     whole catalogue; both gates apply.
CREATE TABLE IF NOT EXISTS "pat_product_attributes" (
    "product_id" TEXT NOT NULL,
    "attribute_id" TEXT NOT NULL,
    "use_for_variations" BOOLEAN NOT NULL DEFAULT false,
    "show_in_filters" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "pat_product_attributes_pkey" PRIMARY KEY ("product_id", "attribute_id"),
    CONSTRAINT "pat_product_attributes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "pat_product_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "pat_attributes"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "pat_product_attributes_attribute_id_idx" ON "pat_product_attributes" ("attribute_id");
