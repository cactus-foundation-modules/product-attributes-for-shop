-- product-attributes-for-shop schema. Every table is prefixed pat_ and all DDL
-- is idempotent (IF NOT EXISTS) so this file is both the fresh-install schema
-- and safe to re-run. Later schema changes ship as new numbered files
-- (002_*.sql, ...) - never edit this one in place once released.
--
-- Cross-module foreign keys to shp_products are safe because shop installs
-- before this module (requiresModules), so the referenced table always exists
-- first.

-- A filterable attribute, e.g. "Material" or "Colour". Global to the shop, not
-- per-product: the whole point is that one attribute spans the catalogue so a
-- storefront filter can offer it once.
--
-- source_option_name records the shop-variations option name an attribute was
-- imported from (e.g. "Colour"), so a re-import updates the same attribute
-- instead of creating a duplicate. NULL for hand-made attributes.
CREATE TABLE IF NOT EXISTS "pat_attributes" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "control_type" TEXT NOT NULL DEFAULT 'CHECKBOX',
    "position" INTEGER NOT NULL DEFAULT 0,
    "show_in_filters" BOOLEAN NOT NULL DEFAULT true,
    "source_option_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pat_attributes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pat_attributes_slug_key" UNIQUE ("slug"),
    CONSTRAINT "pat_attributes_control_type_check" CHECK ("control_type" IN ('CHECKBOX', 'SWATCH', 'DROPDOWN'))
);
CREATE INDEX IF NOT EXISTS "pat_attributes_position_idx" ON "pat_attributes" ("position");

-- A value of an attribute, e.g. "Oak" or "Red". swatch holds a hex colour for
-- swatch-style controls; null otherwise.
CREATE TABLE IF NOT EXISTS "pat_attribute_values" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "attribute_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "swatch" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "pat_attribute_values_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pat_attribute_values_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "pat_attributes"("id") ON DELETE CASCADE,
    CONSTRAINT "pat_attribute_values_attribute_id_slug_key" UNIQUE ("attribute_id", "slug")
);
CREATE INDEX IF NOT EXISTS "pat_attribute_values_attribute_id_idx" ON "pat_attribute_values" ("attribute_id");

-- Assignment of a value to a product. product_id points at shp_products, which
-- covers BOTH ordinary products and the hidden child products shop-variations
-- creates for each variant - that is what makes per-variant attributes work
-- without a second table. A storefront filter matches a parent when the parent
-- itself carries the value, or when any of its variant children do.
CREATE TABLE IF NOT EXISTS "pat_product_values" (
    "product_id" TEXT NOT NULL,
    "value_id" TEXT NOT NULL,
    CONSTRAINT "pat_product_values_pkey" PRIMARY KEY ("product_id", "value_id"),
    CONSTRAINT "pat_product_values_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE,
    CONSTRAINT "pat_product_values_value_id_fkey" FOREIGN KEY ("value_id") REFERENCES "pat_attribute_values"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "pat_product_values_value_id_idx" ON "pat_product_values" ("value_id");

-- Module settings (single row).
CREATE TABLE IF NOT EXISTS "pat_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    -- Hide a filter option that no product in the current view can match.
    "hide_empty_values" BOOLEAN NOT NULL DEFAULT true,
    -- Roll variant attributes up onto the parent product when filtering.
    "include_variant_values" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pat_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pat_settings_singleton_check" CHECK ("id" = 'singleton')
);
INSERT INTO "pat_settings" ("id") VALUES ('singleton') ON CONFLICT DO NOTHING;
