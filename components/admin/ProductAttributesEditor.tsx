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

/**
 * One helping of an attribute on this product, as the editor holds it.
 *
 * A product may use the same attribute more than once - "Top material" and
 * "Frame material" both off Material - so this is keyed by its own identity
 * rather than by the attribute. `id` is the saved row's id, null until the
 * helping has been saved for the first time; `key` is a browser-side handle that
 * exists from the moment it is added, so React and the tick handlers have
 * something stable to hold on to either way.
 */
type Helping = {
  key: string
  id: string | null
  attributeId: string
  /** The name this helping goes by. Empty means "whatever the attribute is called". */
  name: string
  useForVariations: boolean
  showInFilters: boolean
  values: Set<string>
}

const BASE = '/api/m/product-attributes-for-shop/admin'

let helpingKeySeq = 0
const nextKey = () => `h${helpingKeySeq++}`

// A helping flattened to a string, so a whole set can be compared to its
// baseline with one equality check rather than a nested walk.
const fingerprint = (helpings: Helping[]) =>
  JSON.stringify(
    helpings.map((h) => [h.id, h.attributeId, h.name.trim(), h.useForVariations, h.showInFilters, [...h.values].sort()]),
  )

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
  const [helpings, setHelpings] = useState<Helping[]>([])
  const [baseline, setBaseline] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/products/${productId}/assignments`)
      const payload: Payload = await res.json()
      const next: Helping[] = payload.membership.map((m) => ({
        key: nextKey(),
        id: m.id,
        attributeId: m.attributeId,
        name: m.nameOverride ?? '',
        useForVariations: m.useForVariations,
        showInFilters: m.showInFilters,
        values: new Set(payload.assignments.own[m.id] ?? []),
      }))
      setData(payload)
      setHelpings(next)
      setBaseline(fingerprint(next))
    } catch {
      setError('Could not load the attributes.')
    }
  }, [productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to an async helper; every setState runs after an await, never synchronously in the effect body
  useEffect(() => { void load() }, [load])

  const attributeById = useMemo(() => {
    const map = new Map<string, PatAttributeWithValues>()
    for (const a of data?.attributes ?? []) map.set(a.id, a)
    return map
  }, [data])

  /** The name a helping goes by: its own if it has one, else the attribute's. */
  const displayName = useCallback(
    (h: Helping) => h.name.trim() || attributeById.get(h.attributeId)?.name || 'Attribute',
    [attributeById],
  )

  // How many helpings each attribute has. A repeat is what makes a name of its
  // own compulsory, and what rules the helping out of being a variations column.
  const helpingCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const h of helpings) counts.set(h.attributeId, (counts.get(h.attributeId) ?? 0) + 1)
    return counts
  }, [helpings])

  const isRepeat = useCallback((h: Helping) => (helpingCount.get(h.attributeId) ?? 0) > 1, [helpingCount])

  /**
   * The helpings that cannot be saved as they stand, with what is wrong.
   *
   * Two helpings of one attribute have to be told apart by name, which means all
   * but one of them needs a name of its own. Which one goes without is the
   * owner's business, so this only complains about the ones that actually clash
   * rather than insisting the second one added is the one to rename.
   */
  const nameProblems = useMemo(() => {
    const problems = new Map<string, string>()
    const seen = new Map<string, string>()
    for (const h of helpings) {
      const key = `${h.attributeId}|${h.name.trim().toLowerCase()}`
      const first = seen.get(key)
      if (first) {
        const name = displayName(h)
        problems.set(h.key, `This product already has an attribute called “${name}”. Give this one a name of its own - “Frame material”, say.`)
        problems.set(first, `This product already has an attribute called “${name}”. Give this one a name of its own - “Frame material”, say.`)
      } else {
        seen.set(key, h.key)
      }
    }
    return problems
  }, [helpings, displayName])

  const dirty = useMemo(() => baseline != null && fingerprint(helpings) !== baseline, [helpings, baseline])

  const save = useCallback(async () => {
    if (nameProblems.size > 0) {
      throw new Error('Two attributes on this product go by the same name. Give each one a name of its own.')
    }
    const body = {
      membership: helpings.map((h) => ({
        id: h.id,
        attributeId: h.attributeId,
        nameOverride: h.name.trim() || null,
        useForVariations: h.useForVariations,
        showInFilters: h.showInFilters,
        // A per-variant attribute's values live on each variant, so nothing goes
        // up from here for one.
        values: h.useForVariations ? [] : [...h.values],
      })),
    }
    const res = await fetch(`${BASE}/products/${productId}/assignments`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      throw new Error(payload.error ?? 'The attributes would not save.')
    }
    // Reload rather than trust the local copy: a newly added helping has no id
    // until the server gives it one, and without it the next save would add a
    // second copy of the same block instead of updating this one.
    await load()
  }, [productId, helpings, nameProblems, load])

  useProductEditorSave({ dirty, save })
  useProductEditorTabBadge(helpings.length > 0 ? String(helpings.length) : null)

  const updateHelping = useCallback((key: string, patch: (h: Helping) => Helping) => {
    setHelpings((prev) => prev.map((h) => (h.key === key ? patch(h) : h)))
    setStatus(null)
  }, [])

  function addAttribute() {
    if (!addId) return
    const attribute = attributeById.get(addId)
    setHelpings((prev) => [
      ...prev,
      {
        key: nextKey(),
        id: null,
        attributeId: addId,
        // Empty means "go by whatever the attribute is called", which is right
        // for the first helping and is the prompt to rename for a second one.
        name: '',
        useForVariations: false,
        showInFilters: true,
        values: new Set<string>(),
      },
    ])
    setAddId('')
    setStatus(attribute && helpings.some((h) => h.attributeId === addId)
      ? `Added a second helping of ${attribute.name}. Give it a name of its own below.`
      : null)
  }

  function removeHelping(key: string) {
    setHelpings((prev) => prev.filter((h) => h.key !== key))
    setStatus(null)
  }

  function toggleValue(key: string, valueId: string) {
    updateHelping(key, (h) => {
      const values = new Set(h.values)
      if (values.has(valueId)) values.delete(valueId)
      else values.add(valueId)
      return { ...h, values }
    })
  }

  // Adds a value to an attribute from inside the product editor, so the owner
  // never has to break off to the attributes screen mid-edit. The value joins the
  // attribute's shop-wide list (that is what keeps one filter option per real-world
  // thing rather than a private "Oak" per product) and an existing label of the
  // same name is reused rather than duplicated. Unlike everything else on this
  // tab it saves at once - it is a change to the vocabulary, not to this product.
  //
  // The tick it leaves behind, though, belongs to the helping the owner added it
  // under, not to every helping of that attribute - hence the key.
  const addValue = useCallback(
    async (helpingKey: string, attributeId: string, label: string, swatch: string | null): Promise<boolean> => {
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
        setHelpings((prev) =>
          prev.map((h) => {
            if (h.key !== helpingKey || h.useForVariations) return h
            return { ...h, values: new Set(h.values).add(value.id) }
          }),
        )
        setError(null)
        setStatus(null)
        return true
      } catch {
        setError('Could not add that value.')
        return false
      }
    },
    [],
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

  // Every attribute stays on offer, repeat or not: adding a second helping of
  // one is the whole point, it just has to be called something else.
  const available = data.attributes
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
              Variations tab instead. Add the same attribute more than once if you need to - a desk can be
              oak on top and steel underneath - as long as each one gets a name of its own.
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
            {helpings.length === 0 ? (
              <p className="spe-empty">No attributes on this product yet. Add one below.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {helpings.map((h) => {
                  const attribute = attributeById.get(h.attributeId)
                  // A helping whose attribute has since been deleted shop-wide.
                  // Showing it as a stub with a Remove beats it vanishing with
                  // its ticks and no word about why.
                  if (!attribute) {
                    return (
                      <div key={h.key} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            This attribute has been deleted from the shop.
                          </span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeHelping(h.key)}>Remove</button>
                        </div>
                      </div>
                    )
                  }
                  const problem = nameProblems.get(h.key)
                  const repeat = isRepeat(h)
                  const name = displayName(h)
                  return (
                    <div key={h.key} style={{ border: `1px solid ${problem ? 'var(--color-danger)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <div style={{ display: 'grid', gap: '0.25rem', minWidth: 0, flex: '1 1 12rem' }}>
                          <input
                            className="form-control"
                            style={{ fontSize: '0.8125rem', fontWeight: 600, maxWidth: '18rem' }}
                            value={h.name}
                            placeholder={attribute.name}
                            aria-label={`Name for this helping of ${attribute.name}`}
                            onChange={(e) => updateHelping(h.key, (prev) => ({ ...prev, name: e.target.value }))}
                          />
                          <span style={{ fontSize: '0.75rem', color: problem ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                            {problem
                              ?? (repeat
                                ? `One of several helpings of ${attribute.name} on this product, so it needs a name of its own.`
                                : `Leave blank to call it ${attribute.name}, as the shop does.`)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Remove ${name} from this product`}
                          onClick={() => removeHelping(h.key)}
                          style={{ flexShrink: 0 }}
                        >
                          Remove
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: h.useForVariations ? 0 : '0.625rem' }}>
                        {variationsInstalled && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                            <input
                              type="checkbox"
                              checked={h.useForVariations}
                              // Every helping gets a column of its own on the
                              // Variations tab, so an attribute used twice can be
                              // set per variant twice - a main finish and an edge
                              // finish off one Finish. The name each goes by is
                              // what heads the two columns apart.
                              onChange={(e) => updateHelping(h.key, (prev) => ({
                                ...prev,
                                useForVariations: e.target.checked,
                                // Its values move to the variants, so they stop
                                // sitting on the product as a whole.
                                values: e.target.checked ? new Set<string>() : prev.values,
                              }))}
                            />
                            Use for variations
                            {repeat && h.useForVariations && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                (its own column, headed {name})
                              </span>
                            )}
                          </label>
                        )}
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                          <input
                            type="checkbox"
                            checked={h.showInFilters}
                            onChange={(e) => updateHelping(h.key, (prev) => ({ ...prev, showInFilters: e.target.checked }))}
                          />
                          Show in shop filters
                        </label>
                      </div>

                      {h.useForVariations ? (
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
                              <input
                                type="checkbox"
                                checked={h.values.has(value.id)}
                                aria-label={`${value.label} for ${name}`}
                                onChange={() => toggleValue(h.key, value.id)}
                              />
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

                      <AddValueBox
                        attribute={attribute}
                        onAdd={(attributeId, label, swatch) => addValue(h.key, attributeId, label, swatch)}
                      />
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
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {(helpingCount.get(a.id) ?? 0) > 0 ? ' (already on this product)' : ''}
                    </option>
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
