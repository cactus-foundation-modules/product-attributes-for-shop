'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProductEditorSave, useProductEditorTabBadge } from '@/modules/shop/components/admin/product-editor/context'
import type {
  PatAttributeWithValues,
  PatProductAssignments,
  PatProductAttribute,
  PatVariantRef,
} from '@/modules/product-attributes-for-shop/lib/types'

type Payload = {
  attributes: PatAttributeWithValues[]
  assignments: PatProductAssignments
  membership: PatProductAttribute[]
  variants: PatVariantRef[]
}

type MemberFlags = { useForVariations: boolean; showInFilters: boolean }

const BASE = '/api/m/product-attributes-for-shop/admin'

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))

function membershipEqual(a: Map<string, MemberFlags>, b: Map<string, MemberFlags>) {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const w = b.get(k)
    if (!w || w.useForVariations !== v.useForVariations || w.showInFilters !== v.showInFilters) return false
  }
  return true
}

// The Attributes tab on the product editor. A product picks a set of the shop's
// attributes; each can be marked "use for variations" (its value is then set per
// variant, as a column on the Variations tab) and "show in shop filters" (off
// keeps it for internal use only). Non-variation attributes get their value(s)
// ticked here, on the product as a whole.
//
// There is no Save button here: edits hand off to the product editor's single
// Save. Per-variant values are the exception - they live on the Variations tab
// column and save themselves the moment they change.
export function ProductAttributesEditor({ productId, variationsInstalled }: { productId: string; variationsInstalled: boolean }) {
  const [data, setData] = useState<Payload | null>(null)
  const [own, setOwn] = useState<Set<string>>(new Set())
  const [membership, setMembership] = useState<Map<string, MemberFlags>>(new Map())
  const [baseline, setBaseline] = useState<{ own: Set<string>; membership: Map<string, MemberFlags> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/products/${productId}/assignments`)
      const payload: Payload = await res.json()
      const nextOwn = new Set(payload.assignments.own)
      const nextMembership = new Map(
        payload.membership.map((m) => [m.attributeId, { useForVariations: m.useForVariations, showInFilters: m.showInFilters }] as const),
      )
      setData(payload)
      setOwn(nextOwn)
      setMembership(nextMembership)
      setBaseline({ own: nextOwn, membership: nextMembership })
    } catch {
      setError('Could not load the attributes.')
    }
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async helper; every setState runs after an await, never synchronously in the effect body
  useEffect(() => { void load() }, [load])

  const valuesOfAttribute = useCallback(
    (attributeId: string) => (data?.attributes.find((a) => a.id === attributeId)?.values ?? []).map((v) => v.id),
    [data],
  )

  // value id -> attribute id, for stripping a variation attribute's product-level values.
  const attrOfValue = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of data?.attributes ?? []) for (const v of a.values) map.set(v.id, a.id)
    return map
  }, [data])

  const dirty = useMemo(() => {
    if (!baseline) return false
    return !sameSet(own, baseline.own) || !membershipEqual(membership, baseline.membership)
  }, [own, membership, baseline])

  const save = useCallback(async () => {
    const membershipArr = [...membership.entries()].map(([attributeId, f]) => ({
      attributeId,
      useForVariations: f.useForVariations,
      showInFilters: f.showInFilters,
    }))
    const variationAttrs = new Set(membershipArr.filter((m) => m.useForVariations).map((m) => m.attributeId))
    const ownArr = [...own].filter((v) => !variationAttrs.has(attrOfValue.get(v) ?? ''))
    const res = await fetch(`${BASE}/products/${productId}/assignments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ own: ownArr, membership: membershipArr }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      throw new Error(payload.error ?? 'The attributes would not save.')
    }
    setBaseline({ own: new Set(ownArr), membership: new Map(membership) })
    setOwn(new Set(ownArr))
  }, [productId, own, membership, attrOfValue])

  useProductEditorSave({ dirty, save })
  useProductEditorTabBadge(membership.size > 0 ? String(membership.size) : null)

  function addAttribute() {
    if (!addId) return
    setMembership((prev) => {
      if (prev.has(addId)) return prev
      const next = new Map(prev)
      next.set(addId, { useForVariations: false, showInFilters: true })
      return next
    })
    setAddId('')
    setStatus(null)
  }

  function removeAttribute(attributeId: string) {
    setMembership((prev) => {
      const next = new Map(prev)
      next.delete(attributeId)
      return next
    })
    setOwn((prev) => {
      const next = new Set(prev)
      for (const v of valuesOfAttribute(attributeId)) next.delete(v)
      return next
    })
    setStatus(null)
  }

  function updateFlag(attributeId: string, flag: keyof MemberFlags, value: boolean) {
    setMembership((prev) => {
      const current = prev.get(attributeId)
      if (!current) return prev
      const next = new Map(prev)
      next.set(attributeId, { ...current, [flag]: value })
      return next
    })
    // Turning an attribute into a variation one moves its value to each variant,
    // so it no longer sits on the product as a whole.
    if (flag === 'useForVariations' && value) {
      setOwn((prev) => {
        const next = new Set(prev)
        for (const v of valuesOfAttribute(attributeId)) next.delete(v)
        return next
      })
    }
    setStatus(null)
  }

  function toggleOwn(valueId: string) {
    setOwn((prev) => {
      const next = new Set(prev)
      if (next.has(valueId)) next.delete(valueId)
      else next.add(valueId)
      return next
    })
    setStatus(null)
  }

  async function copyFromVariations() {
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
      setStatus(`Imported ${names || 'options'} from this product's variations. Set each variant's value on the Variations tab.`)
    } catch {
      setError('Could not import from the variations.')
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null

  const inSet = data.attributes.filter((a) => membership.has(a.id))
  const available = data.attributes.filter((a) => !membership.has(a.id))
  const hasVariants = data.variants.length > 0

  return (
    <div className="spe-panel">
      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section className="spe-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="spe-section-head">This product&rsquo;s attributes</h3>
            <p className="spe-section-blurb">
              Pick which attributes this product uses. Tick a value for ordinary attributes; turn on{' '}
              <strong>Use for variations</strong> to set the value per variant on the Variations tab instead.
            </p>
          </div>
          {variationsInstalled && hasVariants && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void copyFromVariations()} style={{ flexShrink: 0 }}>
              Copy from variations
            </button>
          )}
        </div>

        {status && <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{status}</p>}

        {data.attributes.length === 0 ? (
          <p className="spe-empty">
            No attributes set up yet. Add some under Shop &rsaquo; Product attributes and they turn up here to pick.
          </p>
        ) : (
          <>
            {inSet.length === 0 ? (
              <p className="spe-empty">No attributes on this product yet. Add one below.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {inSet.map((attribute) => {
                  const flags = membership.get(attribute.id)!
                  return (
                    <div key={attribute.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{attribute.name}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Remove ${attribute.name} from this product`}
                          onClick={() => removeAttribute(attribute.id)}
                        >
                          Remove
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: flags.useForVariations ? 0 : '0.625rem' }}>
                        {variationsInstalled && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                            <input
                              type="checkbox"
                              checked={flags.useForVariations}
                              onChange={(e) => updateFlag(attribute.id, 'useForVariations', e.target.checked)}
                            />
                            Use for variations
                          </label>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                          <input
                            type="checkbox"
                            checked={flags.showInFilters}
                            onChange={(e) => updateFlag(attribute.id, 'showInFilters', e.target.checked)}
                          />
                          Show in shop filters
                        </label>
                      </div>

                      {flags.useForVariations ? (
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {hasVariants
                            ? 'Set each variant’s value in the new column on the Variations tab.'
                            : 'Add variants on the Variations tab, then set each one’s value there.'}
                        </p>
                      ) : attribute.values.length === 0 ? (
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
                  )
                })}
              </div>
            )}

            {available.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.875rem', flexWrap: 'wrap' }}>
                <select
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  aria-label="Attribute to add"
                  style={{
                    padding: '0.375rem 0.5rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <option value="">Add an attribute…</option>
                  {available.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!addId} onClick={addAttribute}>
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
