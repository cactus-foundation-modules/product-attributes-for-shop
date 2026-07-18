'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProductEditorSave, useProductEditorTabBadge } from '@/modules/shop/components/admin/product-editor/context'
import type {
  PatAttributeValue,
  PatAttributeWithValues,
  PatProductAssignments,
  PatProductAttribute,
  PatVariantRef,
} from '@/modules/product-attributes-for-shop/lib/types'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { SwatchImagePicker } from '@/modules/product-attributes-for-shop/components/admin/SwatchImagePicker'

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

  // Adds a value to an attribute from inside the product editor, so the owner
  // never has to break off to the attributes screen mid-edit. The value joins the
  // attribute's shop-wide list (that is what keeps one filter option per real-world
  // thing rather than a private "Oak" per product) and an existing label of the
  // same name is reused rather than duplicated. Unlike everything else on this
  // tab it saves at once - it is a change to the vocabulary, not to this product.
  const addValue = useCallback(
    async (attributeId: string, label: string, swatch: string | null): Promise<boolean> => {
      try {
        const res = await fetch(`${BASE}/attributes/${attributeId}/values`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, swatch, reuseExisting: true }),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(payload.error ?? 'Could not add that value.')
          return false
        }
        const value = payload.value as PatAttributeValue
        setData((prev) =>
          prev
            ? {
                ...prev,
                attributes: prev.attributes.map((a) =>
                  a.id !== attributeId || a.values.some((v) => v.id === value.id)
                    ? a
                    : { ...a, values: [...a.values, value] },
                ),
              }
            : prev,
        )
        // A per-variant attribute's value belongs to a variant, so a new one is
        // only offered in the Variations column; anything else is ticked here.
        if (!membership.get(attributeId)?.useForVariations) {
          setOwn((prev) => new Set(prev).add(value.id))
        }
        setError(null)
        setStatus(null)
        return true
      } catch {
        setError('Could not add that value.')
        return false
      }
    },
    [membership],
  )

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
              Pick which attributes this product uses. Tick a value for ordinary attributes, or add your own
              underneath; turn on <strong>Use for variations</strong> to set the value per variant on the
              Variations tab instead.
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
                            ? 'Set each variant’s value in the new column on the Variations tab. Add the choices it offers below.'
                            : 'Add variants on the Variations tab, then set each one’s value there. Add the choices it offers below.'}
                        </p>
                      ) : attribute.values.length === 0 ? (
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>No values set up yet.</span>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                          {attribute.values.map((value) => (
                            <label key={value.id} className="spe-check" style={{ border: '1px solid var(--color-border)' }}>
                              <input type="checkbox" checked={own.has(value.id)} onChange={() => toggleOwn(value.id)} />
                              {value.swatch && isImageSwatch(value.swatch) ? (
                                // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
                                <img src={value.swatch} alt="" style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }} />
                              ) : value.swatch ? (
                                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 'var(--radius-full)', background: value.swatch, border: '1px solid var(--color-border)' }} />
                              ) : null}
                              {value.label}
                            </label>
                          ))}
                        </div>
                      )}

                      <AddValueBox attribute={attribute} onAdd={addValue} />
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

// The "add a value" row under one attribute on the product editor. Swatch
// attributes get a colour alongside the label and picture attributes get a
// thumbnail, matching the attributes screen, so a value added here still shows
// its visual on the storefront filter rather than a blank circle.
function AddValueBox({
  attribute,
  onAdd,
}: {
  attribute: PatAttributeWithValues
  onAdd: (attributeId: string, label: string, swatch: string | null) => Promise<boolean>
}) {
  const [label, setLabel] = useState('')
  const [swatch, setSwatch] = useState('#888888')
  const [image, setImage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const isSwatch = attribute.controlType === 'SWATCH'
  const isImage = attribute.controlType === 'IMAGE'

  async function submit() {
    const trimmed = label.trim()
    if (!trimmed || saving) return
    setSaving(true)
    const ok = await onAdd(attribute.id, trimmed, isSwatch ? swatch : isImage ? image : null)
    setSaving(false)
    // The picture is cleared with the label - it belonged to the value just added.
    if (ok) { setLabel(''); setImage(null) }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.625rem' }}>
      <input
        className="form-control"
        style={{ flex: '1 1 10rem', minWidth: '8rem', fontSize: '0.8125rem' }}
        placeholder={`Add a ${attribute.name.toLowerCase()} value…`}
        value={label}
        disabled={saving}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // The product editor wraps this in a form; Enter must add a value, not save the product.
            e.preventDefault()
            void submit()
          }
        }}
        aria-label={`New value for ${attribute.name}`}
      />
      {isSwatch && (
        <input
          type="color"
          className="form-control"
          style={{ flex: '0 0 3rem', padding: '0.125rem' }}
          value={swatch}
          disabled={saving}
          onChange={(e) => setSwatch(e.target.value)}
          aria-label={`Colour for the new ${attribute.name} value`}
        />
      )}
      {isImage && (
        <SwatchImagePicker
          attributeId={attribute.id}
          value={image}
          label={`the new ${attribute.name} value`}
          disabled={saving}
          size={28}
          onPick={(url) => setImage(url)}
        />
      )}
      <button type="button" className="btn btn-secondary btn-sm" disabled={saving || !label.trim()} onClick={() => void submit()}>
        Add value
      </button>
    </div>
  )
}
