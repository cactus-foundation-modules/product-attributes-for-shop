import Link from 'next/link'
import { headers } from 'next/headers'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasShopPermission } from '@/modules/shop/lib/access'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { getValueSummary, getValueUsage } from '@/modules/product-attributes-for-shop/lib/db/value-usage'

export const metadata = { title: 'Where this value is used — Admin' }

// Opened in a new tab from the "i" button beside every value on the attributes
// screen. Its whole job is to answer "what would I break by deleting this?" -
// which is what turns tidying a drifted vocabulary from a guess into a decision.
export default async function AttributeValueUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionFromCookie()
  if (!user) return null
  const canAccess = await hasShopPermission(user, 'shop.products', { allowAccess: true })
  if (!canAccess) return <div className="alert alert-danger">You do not have permission to view products.</div>

  const { id } = await params
  const value = await getValueSummary(id)
  if (!value) return <div className="alert alert-danger">That value no longer exists.</div>

  const adminPath = (await headers()).get('x-cactus-admin-path') ?? 'cactus-admin'
  const usage = await getValueUsage(id)
  const variantCount = usage.products.reduce((n, p) => n + p.variants.length, 0)
  const picture = value.swatch && isImageSwatch(value.swatch) ? value.swatch : null
  const colour = value.swatch && !isImageSwatch(value.swatch) ? value.swatch : null

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {picture && (
            // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
            <img
              src={picture}
              alt=""
              width={28}
              height={28}
              style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--color-border)' }}
            />
          )}
          {colour && (
            <span
              aria-hidden
              style={{ width: 18, height: 18, borderRadius: 999, background: colour, border: '1px solid var(--color-border)' }}
            />
          )}
          {value.label}
        </h1>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
          {value.attributeName} &middot; slug <code>{value.slug}</code>
        </p>
      </div>

      {usage.products.length === 0 ? (
        <p style={{ fontSize: '0.9375rem' }}>Nothing uses this value. Deleting it takes nothing with it.</p>
      ) : (
        <p style={{ fontSize: '0.9375rem' }}>
          Used by <strong>{usage.products.length}</strong> product{usage.products.length === 1 ? '' : 's'}.{' '}
          {/* The two routes are counted apart because they behave differently on a
              delete: a ticked value simply goes, while a variation option copied
              from it stays behind under its own name. */}
          Ticked on <strong>{usage.totalRows}</strong> product record{usage.totalRows === 1 ? '' : 's'}
          {variantCount > 0 && <> ({variantCount} of them variations)</>}, and copied onto{' '}
          <strong>{usage.totalOptionValues}</strong> variation option{usage.totalOptionValues === 1 ? '' : 's'} building{' '}
          <strong>{usage.totalVariantRows}</strong> variation{usage.totalVariantRows === 1 ? '' : 's'}.
        </p>
      )}

      {usage.truncated && (
        <p className="alert alert-warning" style={{ fontSize: '0.875rem' }}>
          Only the first {usage.totalRows} rows were read, so this list is partial. The count above is the real total.
        </p>
      )}

      {usage.products.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {usage.products.map((product) => (
            <li
              key={product.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: '0.625rem 0.875rem',
                background: 'var(--color-surface)',
              }}
            >
              <Link href={`/${adminPath}/m/shop/products/${product.id}`} style={{ fontWeight: 500 }}>
                {product.name}
              </Link>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {product.status}
              </span>
              {product.direct && (product.variants.length > 0 || product.options.length > 0) && (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                  ticked on the product itself as well
                </span>
              )}
              {product.options.map((option, index) => (
                <div
                  key={`${option.optionName}-${index}`}
                  style={{ marginTop: '0.25rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}
                >
                  Variation option &ldquo;{option.optionName}&rdquo; offers it as &ldquo;{option.label}&rdquo; on{' '}
                  {option.variantRows} variation{option.variantRows === 1 ? '' : 's'}.
                </div>
              ))}
              {/* Variants collapsed rather than listed flat: a range can carry the
                  same finish on three hundred of them, and the product it belongs
                  to is the answer most of the time. */}
              {product.variants.length > 0 && (
                <details style={{ marginTop: '0.375rem' }}>
                  <summary style={{ cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {product.variants.length} variation{product.variants.length === 1 ? '' : 's'}
                  </summary>
                  <ul style={{ margin: '0.375rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8125rem' }}>
                    {product.variants.map((variant) => (
                      <li key={variant.id}>{variant.name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
