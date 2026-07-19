-- Attribute groups: folders a shop owner can sort the attribute vocabulary into
-- once it grows past the point where one flat list is readable.
--
-- Grouping is an admin-side organisation feature only. The storefront filter
-- still renders one fieldset per attribute in `position` order, so nothing here
-- touches how shoppers see the catalogue - which is also why `group_id` is
-- nullable rather than defaulted: an attribute belongs to no group until
-- somebody puts it in one, and that is a perfectly normal resting state.
CREATE TABLE IF NOT EXISTS "pat_attribute_groups" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pat_attribute_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pat_attribute_groups_slug_key" UNIQUE ("slug")
);

CREATE INDEX IF NOT EXISTS "pat_attribute_groups_position_idx" ON "pat_attribute_groups" ("position");

ALTER TABLE "pat_attributes" ADD COLUMN IF NOT EXISTS "group_id" TEXT;

-- ON DELETE SET NULL, emphatically not CASCADE: deleting a folder must tip its
-- attributes back out onto the ungrouped pile, never take them - and with them
-- every product assignment - down with it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pat_attributes_group_id_fkey'
    ) THEN
        ALTER TABLE "pat_attributes"
            ADD CONSTRAINT "pat_attributes_group_id_fkey"
            FOREIGN KEY ("group_id") REFERENCES "pat_attribute_groups"("id") ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "pat_attributes_group_id_idx" ON "pat_attributes" ("group_id");
