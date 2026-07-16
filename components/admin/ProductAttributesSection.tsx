import { listAttributes } from '@/modules/product-attributes-for-shop/lib/db/attributes'
import { hasVariationsTables } from '@/modules/product-attributes-for-shop/lib/variations-bridge'
import { ProductAttributesEditor } from '@/modules/product-attributes-for-shop/components/admin/ProductAttributesEditor'

// Inline panel hung under the shop product editor via the
// shop.product-editor-sections slot. Server component: it only decides whether
// there is anything worth showing, then hands off to the client editor which
// loads the product's own assignments.
export async function ProductAttributesSection({ productId }: { productId: string }) {
  const [attributes, variationsInstalled] = await Promise.all([listAttributes(), hasVariationsTables()])

  return (
    <section style={{ marginTop: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)' }}>
      <h3 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Attributes</h3>
      {attributes.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          No attributes have been set up yet. Add some under Shop &rsaquo; Product attributes and they will appear here to tick.
        </p>
      ) : (
        <ProductAttributesEditor productId={productId} variationsInstalled={variationsInstalled} />
      )}
    </section>
  )
}
