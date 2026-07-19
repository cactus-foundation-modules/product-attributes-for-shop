'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// The Variations-tab cell for one attribute column on one variant.
// shop-variations renders this once per (variant, use-for-variations helping);
// the column key is the ASSIGNMENT id, so a product using Finish for both its
// main and edge surfaces gets two independent cells rather than two views of one.
// It saves itself the moment the shopper's choice changes, like every other
// contributed variant column - the Variations grid's own Save button carries
// nothing of ours.
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

type Col = {
  assignmentId: string
  attributeId: string
  name: string
  values: { id: string; label: string; swatch: string | null }[]
}
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

// Splices a just-created value into every column drawing on that attribute, so
// the whole grid offers it straight away and not only the cell that typed it.
// Matched on attribute rather than column on purpose: a new finish typed into the
// edge column belongs to Finish, so the main column should offer it too.
function addLocalColumnValue(productId: string, attributeId: string, value: { id: string; label: string; swatch: string | null }) {
  const current = getEntry(productId)
  if (!current.data) return
  const columns = current.data.columns.map((c) =>
    c.attributeId !== attributeId || c.values.some((v) => v.id === value.id) ? c : { ...c, values: [...c.values, value] },
  )
  store.set(productId, { ...current, data: { ...current.data, columns } })
  emit(productId)
}

function setLocalValue(productId: string, childId: string, assignmentId: string, valueId: string) {
  const current = getEntry(productId)
  if (!current.data) return
  const values = { ...current.data.values, [childId]: { ...(current.data.values[childId] ?? {}), [assignmentId]: valueId } }
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

const control: React.CSSProperties = {
  padding: '0.25rem 0.375rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: '0.8125rem',
  minWidth: 96,
}

// Picked from the dropdown to type a value the attribute does not have yet. It is
// not a value id, and the two can never collide: ids are uuids.
const NEW_VALUE = '__new__'

export function ProductAttributesVariantCell({ productId, childProductId, columnKey }: CellProps) {
  const entry = useVariationData(productId)
  const [saving, setSaving] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  // The column key is the assignment. Its attribute is looked up here rather than
  // taken from the key, because adding a value targets the attribute while saving
  // a choice targets the helping, and on a twice-used attribute those differ.
  const col = entry.data?.columns.find((c) => c.assignmentId === columnKey)
  const attributeId = col?.attributeId ?? ''

  const onChange = useCallback(async (valueId: string) => {
    setSaving(true)
    setLocalValue(productId, childProductId, columnKey, valueId)
    try {
      await fetch(`${BASE}/products/${productId}/variant-attribute-value`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childProductId, assignmentId: columnKey, valueId: valueId || null }),
      })
    } finally {
      setSaving(false)
    }
  }, [productId, childProductId, columnKey])

  // Adds a value to the attribute and puts it on this variant in one go. The
  // value joins the attribute's shop-wide list, so the next variant that needs
  // "Oak" picks it from the dropdown rather than typing it again; a label that
  // already exists is reused rather than duplicated.
  const createAndSelect = useCallback(async () => {
    const label = draft.trim()
    if (!label || !attributeId) { setTyping(false); setDraft(''); return }
    setSaving(true)
    try {
      const res = await fetch(`${BASE}/attributes/${attributeId}/values`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, reuseExisting: true }),
      })
      if (!res.ok) return
      const payload = await res.json()
      const value = payload.value as { id: string; label: string; swatch: string | null }
      addLocalColumnValue(productId, attributeId, { id: value.id, label: value.label, swatch: value.swatch })
      setTyping(false)
      setDraft('')
      await onChange(value.id)
    } finally {
      setSaving(false)
    }
  }, [draft, productId, attributeId, onChange])

  if (entry.error) return <span style={muted} title="Could not load attribute values">—</span>
  if (!entry.data || !col) return <span style={muted}>…</span>
  const current = entry.data.values[childProductId]?.[columnKey] ?? ''

  if (typing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={saving}
        placeholder={`New ${col.name.toLowerCase()}…`}
        aria-label={`New ${col.name} value for this variant`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void createAndSelect()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void createAndSelect() }
          if (e.key === 'Escape') { setTyping(false); setDraft('') }
        }}
        style={control}
      />
    )
  }

  return (
    <select
      value={current}
      disabled={saving}
      aria-label={`${col.name} for this variant`}
      onChange={(e) => {
        if (e.target.value === NEW_VALUE) setTyping(true)
        else void onChange(e.target.value)
      }}
      style={control}
    >
      <option value="">—</option>
      {col.values.map((v) => (
        <option key={v.id} value={v.id}>{v.label}</option>
      ))}
      <option value={NEW_VALUE}>+ New value…</option>
    </select>
  )
}
