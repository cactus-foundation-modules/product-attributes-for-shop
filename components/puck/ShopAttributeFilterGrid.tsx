import type { LayoutRef } from '@/lib/puck/LayoutPickerField'
import { ShopLayoutPicker } from '@/modules/shop/components/public/ShopLayoutPicker'

// EDITOR half only: placeholder + Puck field config. The server render (db
// access, card stamping, filter panel) lives in ShopAttributeFilterGrid.rsc.tsx,
// wired by `rscImport` in the manifest so it never lands in the client editor
// bundle. Mirrors the shop's own ShopProductGrid split for the same reason:
// lib/card-template dynamically imports lib/puck/config.rsc, which is tainted by
// next/headers.
export type ShopAttributeFilterGridProps = {
  categorySlug?: string
  collectionSlug?: string
  tagSlug?: string
  limit?: number
  columns?: number
  filterPosition?: string
  showCounts?: string
  layoutRef?: LayoutRef | null
}

function FilterGridSkeleton({ columns, position }: { columns: number; position: string }) {
  const bar = (width: string, height = 11) => (
    <div style={{ height, width, background: 'var(--color-border)', borderRadius: 4 }} />
  )
  const filters = (
    <div style={{ display: 'flex', flexDirection: position === 'top' ? 'row' : 'column', gap: position === 'top' ? 24 : 18, flexWrap: 'wrap' }}>
      {['Colour', 'Material', 'Size'].map((name) => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {bar('4.5rem', 12)}
          {bar('6rem')}
          {bar('5rem')}
          {bar('5.5rem')}
        </div>
      ))}
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 28, gridTemplateColumns: position === 'left' ? 'minmax(180px,220px) 1fr' : '1fr', alignItems: 'start', opacity: 0.6 }}>
      {filters}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`, gap: 24 }}>
        {Array.from({ length: columns * 2 }).map((_, i) => (
          <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--color-surface)' }}>
            <div style={{ aspectRatio: '4/3', background: 'var(--color-bg-subtle)' }} />
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bar('70%', 14)}
              {bar('35%', 14)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Editor canvas: static skeleton, no fetch during render (Gazette pattern).
export function ShopAttributeFilterGrid(props: ShopAttributeFilterGridProps) {
  return <FilterGridSkeleton columns={props.columns ?? 3} position={props.filterPosition ?? 'left'} />
}

const layoutField = {
  type: 'custom' as const,
  label: 'Card layout',
  render: ({ value, onChange }: any) => <ShopLayoutPicker type="shopProductCard" value={value} onChange={onChange} />,
}

export const shopAttributeFilterGridPuckComponent = {
  label: 'Shop: Filtered Product Grid',
  fields: {
    categorySlug: { type: 'text' as const, label: 'Category slug (optional)' },
    collectionSlug: { type: 'text' as const, label: 'Collection slug (optional)' },
    tagSlug: { type: 'text' as const, label: 'Tag slug (optional)' },
    limit: { type: 'number' as const, label: 'Number of products' },
    columns: { type: 'number' as const, label: 'Columns' },
    filterPosition: {
      type: 'select' as const,
      label: 'Filters',
      options: [
        { value: 'left', label: 'Down the left' },
        { value: 'top', label: 'Across the top' },
      ],
    },
    showCounts: {
      type: 'select' as const,
      label: 'Show product counts',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    },
    layoutRef: layoutField,
  },
  defaultProps: {
    categorySlug: '',
    collectionSlug: '',
    tagSlug: '',
    limit: 24,
    columns: 3,
    filterPosition: 'left',
    showCounts: 'yes',
    layoutRef: null,
  },
  render: ShopAttributeFilterGrid,
}
