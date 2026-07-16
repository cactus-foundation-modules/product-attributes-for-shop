'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PatAttributeWithValues, PatProductAssignments, PatVariantRef } from '@/modules/product-attributes-for-shop/lib/types'

type Payload = {
  attributes: PatAttributeWithValues[]
  assignments: PatProductAssignments
  variants: PatVariantRef[]
}

const BASE = '/api/m/product-attributes-for-shop/admin'

// Ticks attribute values onto the product, and onto each variant when
// shop-variations is installed. Per-variant values are what make "Colour: Red"
// find a product whose red is only one of its variants.
export function ProductAttributesEditor({ productId, variationsInstalled }: { productId: string; variationsInstalled: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [own, setOwn] = useState<Set<string>>(new Set())
  const [byVariant, setByVariant] = useState<Record<string, Set<string>>>({})
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [openVariants, setOpenVariants] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/products/${productId}/assignments`)
      const payload: Payload = await res.json()
      setData(payload)
      setOwn(new Set(payload.assignments.own))
      setByVariant(
        Object.fromEntries(Object.entries(payload.assignments.byVariant).map(([k, v]) => [k, new Set(v)])),
      )
    } catch {
      setError('Could not load attributes.')
    }
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { void load() }, [load])

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

  async function save() {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
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
        setError(payload.error ?? 'Could not save attributes.')
        return
      }
      setStatus('Attributes saved.')
    } catch {
      setError('Could not save attributes.')
    } finally {
      setBusy(false)
    }
  }

  async function importFromVariations() {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await fetch(`${BASE}/products/${productId}/import-variations`, { method: 'POST' })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(payload.error ?? 'Could not import from variations.')
        return
      }
      await load()
      const names = (payload.optionNames ?? []).join(', ')
      setStatus(`Imported ${names || 'options'} from this product's variations.`)
    } catch {
      setError('Could not import from variations.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const hasVariants = data.variants.length > 0

  return (
    <div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {data.attributes.map((attribute) => (
          <div key={attribute.id}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>{attribute.name}</div>
            {attribute.values.length === 0 ? (
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No values set up yet.</span>
            ) : (
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {attribute.values.map((value) => (
                  <label key={value.id} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={own.has(value.id)} onChange={() => toggleOwn(value.id)} />
                    {value.swatch && (
                      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: value.swatch, border: '1px solid var(--color-border)' }} />
                    )}
                    {value.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {variationsInstalled && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h4 style={{ fontSize: '0.875rem', margin: 0 }}>Per-variant attributes</h4>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                {hasVariants
                  ? 'Set attributes on individual variants. This product shows up in a filter when any of its variants match.'
                  : 'This product has no variants yet. Add some under Variations & personalisation first.'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {hasVariants && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void importFromVariations()}>
                  Import from variations
                </button>
              )}
              {hasVariants && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenVariants((v) => !v)}>
                  {openVariants ? 'Hide variants' : `Show ${data.variants.length} variant${data.variants.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>

          {openVariants && hasVariants && (
            <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.75rem' }}>
              {data.variants.map((variant) => (
                <div key={variant.childProductId} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.625rem 0.75rem' }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.375rem' }}>
                    {variant.label}
                    {!variant.enabled && (
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.5rem' }}>
                        (disabled - left out of filters)
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
        </div>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()}>Save attributes</button>
        {status && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>
    </div>
  )
}
