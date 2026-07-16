'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProductEditorSave, useProductEditorTabBadge } from '@/modules/shop/components/admin/product-editor/context'
import type { PatAttributeWithValues, PatProductAssignments, PatVariantRef } from '@/modules/product-attributes-for-shop/lib/types'

type Payload = {
  attributes: PatAttributeWithValues[]
  assignments: PatProductAssignments
  variants: PatVariantRef[]
}

const BASE = '/api/m/product-attributes-for-shop/admin'

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))

// Ticks attribute values onto the product, and onto each variant when
// shop-variations is installed. Per-variant values are what make "Colour: Red"
// find a product whose red is only one of its variants.
//
// There is no save button here on purpose: the tab hands its edits to the
// product editor's single Save, so one click saves the product and its
// attributes together.
export function ProductAttributesEditor({ productId, variationsInstalled }: { productId: string; variationsInstalled: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [own, setOwn] = useState<Set<string>>(new Set())
  const [byVariant, setByVariant] = useState<Record<string, Set<string>>>({})
  const [baseline, setBaseline] = useState<{ own: Set<string>; byVariant: Record<string, Set<string>> } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openVariants, setOpenVariants] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/products/${productId}/assignments`)
      const payload: Payload = await res.json()
      const nextOwn = new Set(payload.assignments.own)
      const nextByVariant = Object.fromEntries(
        Object.entries(payload.assignments.byVariant).map(([k, v]) => [k, new Set(v)]),
      )
      setData(payload)
      setOwn(nextOwn)
      setByVariant(nextByVariant)
      setBaseline({ own: nextOwn, byVariant: nextByVariant })
    } catch {
      setError('Could not load the attributes.')
    }
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async helper; every setState in it runs after an await, never synchronously in the effect body
  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => {
    if (!baseline) return false
    if (!sameSet(own, baseline.own)) return true
    const keys = new Set([...Object.keys(byVariant), ...Object.keys(baseline.byVariant)])
    for (const key of keys) {
      if (!sameSet(byVariant[key] ?? new Set(), baseline.byVariant[key] ?? new Set())) return true
    }
    return false
  }, [own, byVariant, baseline])

  const save = useCallback(async () => {
    const res = await fetch(`${BASE}/products/${productId}/assignments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        own: [...own],
        byVariant: Object.fromEntries(Object.entries(byVariant).map(([k, v]) => [k, [...v]])),
      }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      throw new Error(payload.error ?? 'The attributes would not save.')
    }
    setBaseline({ own: new Set(own), byVariant: Object.fromEntries(Object.entries(byVariant).map(([k, v]) => [k, new Set(v)])) })
  }, [productId, own, byVariant])

  useProductEditorSave({ dirty, save })
  useProductEditorTabBadge(own.size > 0 ? String(own.size) : null)

  function toggleOwn(valueId: string) {
    setOwn((prev) => {
      const next = new Set(prev)
      if (next.has(valueId)) next.delete(valueId)
      else next.add(valueId)
      return next
    })
    setStatus(null)
  }

  function toggleVariant(childProductId: string, valueId: string) {
    setByVariant((prev) => {
      const next = { ...prev }
      const set = new Set(next[childProductId] ?? [])
      if (set.has(valueId)) set.delete(valueId)
      else set.add(valueId)
      next[childProductId] = set
      return next
    })
    setStatus(null)
  }

  async function importFromVariations() {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await fetch(`${BASE}/products/${productId}/import-variations`, { method: 'POST' })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error ?? 'Could not import from the variations.')
        return
      }
      await load()
      const names = (payload.optionNames ?? []).join(', ')
      setStatus(`Imported ${names || 'options'} from this product's variations.`)
    } catch {
      setError('Could not import from the variations.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const hasVariants = data.variants.length > 0

  return (
    <div className="spe-panel">
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section className="spe-section">
        <h3 className="spe-section-head">This product&rsquo;s attributes</h3>
        <p className="spe-section-blurb">
          Tick what this product is made of, comes in, or counts as. Shoppers use these to narrow the shop down to what
          they actually want.
        </p>

        {data.attributes.length === 0 ? (
          <p className="spe-empty">
            No attributes set up yet. Add some under Shop &rsaquo; Product attributes and they turn up here to tick.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {data.attributes.map((attribute) => (
              <div key={attribute.id}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>{attribute.name}</div>
                {attribute.values.length === 0 ? (
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No values set up yet.</span>
                ) : (
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {attribute.values.map((value) => (
                      <label key={value.id} className="spe-check" style={{ border: '1px solid var(--color-border)' }}>
                        <input type="checkbox" checked={own.has(value.id)} onChange={() => toggleOwn(value.id)} />
                        {value.swatch && (
                          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: value.swatch, border: '1px solid var(--color-border)' }} />
                        )}
                        {value.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {variationsInstalled && data.attributes.length > 0 && (
        <section className="spe-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h3 className="spe-section-head">Per-variant attributes</h3>
              <p className="spe-section-blurb">
                {hasVariants
                  ? 'Set attributes on individual variants. The product then shows up in a filter when any one of its variants matches, which is what makes a red-and-blue mug findable under red.'
                  : 'This product has no variants yet. Add some on the Variations tab first.'}
              </p>
            </div>
            {hasVariants && (
              <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void importFromVariations()}>
                  Copy from variations
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenVariants((v) => !v)}>
                  {openVariants ? 'Hide variants' : `Show ${data.variants.length} variant${data.variants.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </div>

          {status && <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{status}</p>}

          {openVariants && hasVariants && (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {data.variants.map((variant) => (
                <div key={variant.childProductId} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.625rem 0.75rem' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
                    {variant.label}
                    {!variant.enabled && (
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                        (not on sale, so left out of filters)
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {data.attributes.map((attribute) => (
                      attribute.values.length === 0 ? null : (
                        <div key={attribute.id} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', minWidth: '5rem' }}>{attribute.name}</span>
                          {attribute.values.map((value) => (
                            <label key={value.id} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                              <input
                                type="checkbox"
                                checked={byVariant[variant.childProductId]?.has(value.id) ?? false}
                                onChange={() => toggleVariant(variant.childProductId, value.id)}
                              />
                              {value.label}
                            </label>
                          ))}
                        </div>
                      )
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
