# Product Attributes for Shop

Filterable product attributes for the [Cactus](https://github.com/usersaynoso/cactus-foundation) shop. Define the things shoppers actually browse by - Material, Colour, Room, Finish - assign them to products and to individual variants, then drop a filtered product grid onto the storefront.

Requires the [shop](https://github.com/cactus-foundation-modules/shop) module. Works happily alongside [shop-variations](https://github.com/cactus-foundation-modules/shop-variations), but does not need it.

## What it does

- **A shop-wide attribute vocabulary.** Attributes live under **Shop › Product attributes**, not on individual products, so one "Colour" filter spans the whole catalogue instead of a different one per product.
- **Four ways to pick.** Each attribute renders as a tick list, colour swatches, picture swatches, or a dropdown.
- **Picture swatches.** A value can carry a picture instead of a colour - an oak grain, a fabric weave, a finish - chosen from your media library or dropped straight onto the thumbnail. Pictures are filed under **Shop › Attributes › (the attribute)**, not under a product, because a value belongs to the whole catalogue rather than to whichever product was open at the time. Each picture can also record how big the real material in it is - "20cm", "200mm", whatever your supplier quoted - which is what lets a 3D viewer draw the weave at its true size rather than a guessed one. Optional, and editable later, since that figure usually turns up after the photograph does.
- **Per-product and per-variant assignment.** An "Attributes" panel appears in the product editor. Where a product has variants, each variant can carry its own values.
- **Values added where they are needed.** A value can be typed straight onto the product's Attributes tab, or from a variant's cell on the Variations tab, without breaking off to the attributes screen. It joins the attribute's shop-wide list (an existing label is reused, not duplicated), so the vocabulary stays shared while the typing happens in context.
- **Import from variations.** One button turns a product's existing Size/Colour options into filterable attributes and attaches them to the right variants, so nothing is typed twice.
- **A filtered storefront grid.** A Puck block that renders your existing Product Card layout and filters instantly in the browser, with the selection mirrored into the URL so a filtered view can be shared.

## How filtering behaves

Values within one attribute are OR'd, separate attributes are AND'd. Ticking Red and Blue under Colour, plus Oak under Material, means *(red or blue) and oak* - the same way every high-street shop filter works.

A product matches a value if the product itself carries it, **or** if any of its enabled variants does. So a shirt that only comes in red as one of its four variants still turns up under "Colour: Red". Disabled variants are left out - a switched-off variant is not buyable, so letting it pull its parent into a result would be a dead end.

## The storefront block

**Shop: Filtered Product Grid**, available on Shop Home, Category and Collection layouts.

| Option | What it does |
| --- | --- |
| Category / Collection / Tag slug | Narrows the source products, same as the shop's own grid |
| Number of products | How many to render (capped at 100 by the shop's product list) |
| Columns | Grid columns |
| Filters | Down the left, or across the top |
| Show product counts | Whether each option shows how many products match |
| Card layout | Which Product Card layout to stamp; falls back to your published default |

Cards are rendered server-side using your own Product Card layout, then shown and hidden in place as filters change. Filtering is instant with no page reload, and it only ever covers the products the block rendered - so the "Number of products" cap is the honest ceiling. A catalogue in the thousands wants a paginated, server-filtered grid instead; this block is built for the sizes this platform is actually aimed at.

Filter options that nothing on the page can match are hidden by default, so a category page never offers a tick that always returns nothing.

## Admin

| Where | What |
| --- | --- |
| Shop › Product attributes | Define attributes and their values |
| Shop › Products › (a product) › Attributes | Tick values for the product and its variants, import from variations |

Everything is gated on the shop's existing `shop.products` permission. The module adds no permissions of its own.

## Data

Four tables, all prefixed `pat_`:

- `pat_attributes` - the vocabulary
- `pat_attribute_values` - values of each attribute (the `swatch` column holds a hex colour for a colour attribute and a picture url for a picture one - one visual per value either way)
- `pat_product_values` - which products carry which values (variant child products included, which is what makes per-variant attributes work without a second table)
- `pat_settings` - single row: hide empty filter options, roll variant values up onto the parent

Uninstalling drops all four.

## Notes for developers

shop-variations is an optional companion, so every read of the `svr_` tables goes through `lib/variations-bridge.ts` using raw SQL guarded by a `to_regclass` probe. Nothing here imports from `@/modules/shop-variations/...` - that path does not exist on an install without the module, and a static import would break the build there.

## Licence

MIT
