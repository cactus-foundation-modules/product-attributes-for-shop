'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// The Variations-tab cell for one attribute on one variant. shop-variations
// renders this once per (variant, use-for-variations attribute); the column key
// is the attribute id. It saves itself the moment the shopper's choice changes,
// like every other contributed variant column - the Variations grid's own Save
// button carries nothing of ours.
//
// Props are declared locally, not imported from shop-variations: that module is
// an optional companion whose files do not exist on an install without it, so a
// static import - even of a type - would break the build there.
type CellProps = {
  productId: string
  variantId: string
  childProductId: string
  columnKey: string
  label: string
}

const BASE = '/api/m/product-attributes-for-shop/admin'

type Col = { attributeId: string; name: string; values: { id: string; label: string; swatch: string | null }[] }
type VariationData = { columns: Col[]; values: Record<string, Record<string, string>> }
type Entry = { data: VariationData | null; loading: boolean; error: boolean }

// One shared fetch per product, so a grid of variants is one request, not one per
// cell, and a save in any cell updates every cell that shows the same variant.
const store = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()

function emit(productId: string) {
  listeners.get(productId)?.forEach((l) => l())
}

function getEntry(productId: string): Entry {
  let entry = store.get(productId)
  if (!entry) {
    entry = { data: null, loading: false, error: false }
    store.set(productId, entry)
  }
  return entry
}

async function ensureLoaded(productId: string) {
  const current = getEntry(productId)
  if (current.data || current.loading) return
  store.set(productId, { ...current, loading: true })
  emit(productId)
  try {
    const res = await fetch(`${BASE}/products/${productId}/variation-attributes`)
    if (!res.ok) throw new Error('load failed')
    const data: VariationData = await res.json()
    store.set(productId, { data, loading: false, error: false })
  } catch {
    store.set(productId, { data: null, loading: false, error: true })
  }
  emit(productId)
}

function setLocalValue(productId: string, childId: string, attributeId: string, valueId: string) {
  const current = getEntry(productId)
  if (!current.data) return
  const values = { ...current.data.values, [childId]: { ...(current.data.values[childId] ?? {}), [attributeId]: valueId } }
  store.set(productId, { ...current, data: { ...current.data, values } })
  emit(productId)
}

function useVariationData(productId: string): Entry {
  const subscribe = useCallback((cb: () => void) => {
    let set = listeners.get(productId)
    if (!set) {
      set = new Set()
      listeners.set(productId, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }, [productId])
  const snapshot = useCallback(() => getEntry(productId), [productId])
  const entry = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => { void ensureLoaded(productId) }, [productId])
  return entry
}

const muted: React.CSSProperties = { color: 'var(--color-text-muted)', fontSize: '0.8125rem' }

export function ProductAttributesVariantCell({ productId, childProductId, columnKey }: CellProps) {
  const entry = useVariationData(productId)
  const [saving, setSaving] = useState(false)

  const onChange = useCallback(async (valueId: string) => {
    setSaving(true)
    setLocalValue(productId, childProductId, columnKey, valueId)
    try {
      await fetch(`${BASE}/products/${productId}/variant-attribute-value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childProductId, attributeId: columnKey, valueId: valueId || null }),
      })
    } finally {
      setSaving(false)
    }
  }, [productId, childProductId, columnKey])

  if (entry.error) return <span style={muted} title="Could not load attribute values">—</span>
  const col = entry.data?.columns.find((c) => c.attributeId === columnKey)
  if (!entry.data || !col) return <span style={muted}>…</span>
  const current = entry.data.values[childProductId]?.[columnKey] ?? ''

  return (
    <select
      value={current}
      disabled={saving}
      aria-label={`${col.name} for this variant`}
      onChange={(e) => void onChange(e.target.value)}
      style={{
        padding: '0.25rem 0.375rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        fontSize: '0.8125rem',
        minWidth: 96,
      }}
    >
      <option value="">—</option>
      {col.values.map((v) => (
        <option key={v.id} value={v.id}>{v.label}</option>
      ))}
    </select>
  )
}
