'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProductEditorSave, useProductEditorTabBadge } from '@/modules/shop/components/admin/product-editor/context'
import type {
  PatAttributeValue,
  PatAttributeWithValues,
  PatProductAssignments,
  PatProductAttribute,
  PatProductSpecSection,
  PatVariantRef,
} from '@/modules/product-attributes-for-shop/lib/types'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { SwatchImagePicker } from '@/modules/product-attributes-for-shop/components/admin/SwatchImagePicker'

type Payload = {
  attributes: PatAttributeWithValues[]
  assignments: PatProductAssignments
  membership: PatProductAttribute[]
  variants: PatVariantRef[]
  sections: PatProductSpecSection[]
}

// One Specification section as the editor holds it. `id` is the saved row's id,
// null until first save; `key` is a browser-side handle that exists from the
// moment it is added, so a helping can point at a section before it has an id.
type Section = {
  key: string
  id: string | null
  name: string
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
  // Whether the helping shows on the public product page's Specification tab, and
  // where: which section (by the section's browser `key`, null for the
  // unsectioned run before the first heading) and in what order within it.
  showInSpec: boolean
  specSectionKey: string | null
  specPosition: number
  values: Set<string>
}

const BASE = '/api/m/product-attributes-for-shop/admin'

let helpingKeySeq = 0
const nextKey = () => `h${helpingKeySeq++}`

let sectionKeySeq = 0
const nextSectionKey = () => `s${sectionKeySeq++}`

// A helping flattened to a string, so a whole set can be compared to its
// baseline with one equality check rather than a nested walk. Sections come
// along so a rename, reorder or an attribute dragged between them counts as a
// change worth saving.
const fingerprint = (helpings: Helping[], sections: Section[]) =>
  JSON.stringify({
    h: helpings.map((h) => [
      h.id, h.attributeId, h.name.trim(), h.useForVariations, h.showInFilters,
      h.showInSpec, h.specSectionKey, h.specPosition, [...h.values].sort(),
    ]),
    s: sections.map((s) => [s.id, s.name.trim()]),
  })

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
  const [sections, setSections] = useState<Section[]>([])
  const [baseline, setBaseline] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addId, setAddId] = useState('')
  const [draggedKey, setDraggedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/products/${productId}/assignments`)
      const payload: Payload = await res.json()
      const nextSections: Section[] = payload.sections.map((s) => ({ key: nextSectionKey(), id: s.id, name: s.name }))
      const idToKey = new Map(nextSections.map((s) => [s.id, s.key]))
      const next: Helping[] = payload.membership.map((m) => ({
        key: nextKey(),
        id: m.id,
        attributeId: m.attributeId,
        name: m.nameOverride ?? '',
        useForVariations: m.useForVariations,
        showInFilters: m.showInFilters,
        showInSpec: m.showInSpec,
        specSectionKey: m.specSectionId ? idToKey.get(m.specSectionId) ?? null : null,
        specPosition: m.specPosition,
        values: new Set(payload.assignments.own[m.id] ?? []),
      }))
      setData(payload)
      setHelpings(next)
      setSections(nextSections)
      setBaseline(fingerprint(next, nextSections))
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

  const dirty = useMemo(
    () => baseline != null && fingerprint(helpings, sections) !== baseline,
    [helpings, sections, baseline],
  )

  const save = useCallback(async () => {
    if (nameProblems.size > 0) {
      throw new Error('Two attributes on this product go by the same name. Give each one a name of its own.')
    }
    const body = {
      // Empty-named sections never persist (nothing to head a group with), so
      // they are dropped here; a helping left in one falls back to unsectioned.
      sections: sections
        .filter((s) => s.name.trim())
        .map((s, index) => ({ id: s.id, key: s.key, name: s.name.trim(), position: index })),
      membership: helpings.map((h) => ({
        id: h.id,
        attributeId: h.attributeId,
        nameOverride: h.name.trim() || null,
        useForVariations: h.useForVariations,
        showInFilters: h.showInFilters,
        showInSpec: h.showInSpec,
        // Only meaningful when shown; cleared otherwise so a hidden helping keeps
        // no stale placement.
        specSectionKey: h.showInSpec ? h.specSectionKey : null,
        specPosition: h.specPosition,
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
    // Reload rather than trust the local copy: a newly added helping (or section)
    // has no id until the server gives it one, and without it the next save would
    // add a second copy instead of updating this one.
    await load()
  }, [productId, helpings, sections, nameProblems, load])

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
        showInSpec: false,
        specSectionKey: null,
        specPosition: 0,
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

  function addSection() {
    setSections((prev) => [...prev, { key: nextSectionKey(), id: null, name: '' }])
    setStatus(null)
  }

  function renameSection(key: string, name: string) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, name } : s)))
    setStatus(null)
  }

  // Removing a section tips its attributes back into the unsectioned run rather
  // than hiding them - the same courtesy the database FK extends (ON DELETE SET
  // NULL). They keep showing on the page, just without a heading over them.
  function removeSection(key: string) {
    setSections((prev) => prev.filter((s) => s.key !== key))
    setHelpings((prev) => prev.map((h) => (h.specSectionKey === key ? { ...h, specSectionKey: null } : h)))
    setStatus(null)
  }

  function moveSection(key: string, dir: -1 | 1) {
    setSections((prev) => {
      const index = prev.findIndex((s) => s.key === key)
      const swap = index + dir
      if (index < 0 || swap < 0 || swap >= prev.length) return prev
      const next = [...prev]
      const a = next[index]
      const b = next[swap]
      if (!a || !b) return prev
      next[index] = b
      next[swap] = a
      return next
    })
    setStatus(null)
  }

  // Drops the dragged helping into a section (null = the unsectioned run) just
  // before `beforeKey`, or at the end when it is null. `hidden` means it was
  // dropped back into the "Not shown" pool, so it comes off the page entirely.
  // Only the target run's positions are renumbered; the source run keeps its
  // order (gaps are harmless, everything reads back sorted by position).
  function placeHelping(draggedKeyArg: string, sectionKey: string | null, beforeKey: string | null, hidden = false) {
    if (hidden) {
      setHelpings((prev) =>
        prev.map((h) => (h.key === draggedKeyArg ? { ...h, showInSpec: false, specSectionKey: null } : h)),
      )
      setStatus(null)
      return
    }
    setHelpings((prev) => {
      let next = prev.map((h) =>
        h.key === draggedKeyArg ? { ...h, showInSpec: true, specSectionKey: sectionKey } : h,
      )
      const ordered = next
        .filter((h) => h.showInSpec && (h.specSectionKey ?? null) === sectionKey)
        .sort((a, b) => a.specPosition - b.specPosition)
        .map((h) => h.key)
        .filter((k) => k !== draggedKeyArg)
      const at = beforeKey ? ordered.indexOf(beforeKey) : -1
      ordered.splice(at === -1 ? ordered.length : at, 0, draggedKeyArg)
      const posByKey = new Map(ordered.map((k, i) => [k, i]))
      next = next.map((h) => (posByKey.has(h.key) ? { ...h, specPosition: posByKey.get(h.key) as number } : h))
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

  // The helpings that appear on the Specification tab, and how they fall into the
  // product's sections. A helping whose attribute has since been deleted
  // shop-wide is left out here (it shows as a stub above with a Remove).
  const specHelpings = helpings.filter((h) => h.showInSpec && attributeById.has(h.attributeId))
  const chipsFor = (sectionKey: string | null) =>
    specHelpings
      .filter((h) => (h.specSectionKey ?? null) === sectionKey)
      .sort((a, b) => a.specPosition - b.specPosition)
  // Attributes not currently on the page - the pool a shop owner drags from.
  // Both ordinary and per-variant helpings qualify: an ordinary one shows its
  // ticked value, a per-variant one shows its variants' distinct values, so
  // either can be listed and grouped on the Specification tab.
  const notShownHelpings = helpings.filter(
    (h) => !h.showInSpec && attributeById.has(h.attributeId),
  )

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
                                // sitting on the product as a whole. Any spec
                                // placement stays put: a per-variant helping can
                                // still show on the page, drawing its variants'
                                // distinct values instead of a single ticked one.
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

      {data.attributes.length > 0 && (
        <section className="spe-section" style={{ marginTop: '1.5rem' }}>
          <h3 className="spe-section-head">Specification layout</h3>
          <p className="spe-section-blurb">
            Drag any attribute from <strong>Not shown</strong> onto the page to list it on the product&rsquo;s
            Specification tab. Add a section - &ldquo;Mechanisms&rdquo;, &ldquo;Guarantee&rdquo; - and drop
            attributes into it to group them under that heading. Anything shown but left loose sits above the first
            heading. Drag one back to <strong>Not shown</strong> to take it off the page. A per-variant attribute
            shows the distinct values its variants use, so it can be grouped here too.
          </p>

          {/* Nothing to place yet - the product has no attributes (or every one
              has since been deleted shop-wide), so the buckets below would
              otherwise be an unexplained row of empties. */}
          {specHelpings.length === 0 && notShownHelpings.length === 0 && (
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              Add an attribute to this product above, then it turns up here to drag onto the page.
            </p>
          )}

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              On the Specification tab
            </div>

            {/* The unsectioned run, shown above the first heading on the page.
                Always a drop target so an attribute can be pulled out of a
                section, even when it currently holds nothing. */}
            <SpecBucket
              sectionKey={null}
              chips={chipsFor(null)}
              displayName={displayName}
              draggedKey={draggedKey}
              setDraggedKey={setDraggedKey}
              onPlace={placeHelping}
              emptyHint="Drag attributes here to show them above the first heading."
            />

            {sections.map((section, index) => (
              <div
                key={section.key}
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}
              >
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <input
                    className="form-control"
                    style={{ fontSize: '0.8125rem', fontWeight: 600, flex: '1 1 12rem', maxWidth: '20rem' }}
                    value={section.name}
                    placeholder="Section name, e.g. Mechanisms"
                    aria-label="Section name"
                    onChange={(e) => renameSection(section.key, e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label="Move section up"
                    disabled={index === 0}
                    onClick={() => moveSection(section.key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label="Move section down"
                    disabled={index === sections.length - 1}
                    onClick={() => moveSection(section.key, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove ${section.name.trim() || 'this'} section`}
                    onClick={() => removeSection(section.key)}
                  >
                    Remove
                  </button>
                </div>
                <SpecBucket
                  sectionKey={section.key}
                  chips={chipsFor(section.key)}
                  displayName={displayName}
                  draggedKey={draggedKey}
                  setDraggedKey={setDraggedKey}
                  onPlace={placeHelping}
                  emptyHint="Drag attributes into this section."
                />
              </div>
            ))}

            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addSection}>
                Add section
              </button>
            </div>

            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '0.25rem' }}>
              Not shown on the page
            </div>
            <SpecBucket
              sectionKey={null}
              hidden
              chips={notShownHelpings}
              displayName={displayName}
              draggedKey={draggedKey}
              setDraggedKey={setDraggedKey}
              onPlace={placeHelping}
              emptyHint="Attributes you're not showing sit here. Drag one onto the page above, or drag a shown one back here."
            />
          </div>
        </section>
      )}
    </div>
  )
}

// A drop target on the Specification layout: the unsectioned run or one section.
// Chips are the shown attributes, draggable between buckets. Native HTML5 drag,
// the same mechanism the attributes screen uses to reorder values - no library.
function SpecBucket({
  sectionKey,
  chips,
  displayName,
  draggedKey,
  setDraggedKey,
  onPlace,
  emptyHint,
  hidden = false,
}: {
  sectionKey: string | null
  chips: Helping[]
  displayName: (h: Helping) => string
  draggedKey: string | null
  setDraggedKey: (key: string | null) => void
  onPlace: (draggedKey: string, sectionKey: string | null, beforeKey: string | null, hidden?: boolean) => void
  emptyHint: string
  // The "Not shown" pool: a drop here takes the attribute off the page rather
  // than placing it. Its chips are drawn muted to read as parked, not live.
  hidden?: boolean
}) {
  return (
    <div
      onDragOver={(e) => {
        if (draggedKey) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (draggedKey) onPlace(draggedKey, sectionKey, null, hidden)
        setDraggedKey(null)
      }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.375rem',
        minHeight: '2.25rem',
        alignItems: 'center',
        padding: '0.375rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px dashed var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {chips.length === 0 ? (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0 0.25rem' }}>{emptyHint}</span>
      ) : (
        chips.map((h) => (
          <span
            key={h.key}
            draggable
            onDragStart={(e) => {
              setDraggedKey(h.key)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => setDraggedKey(null)}
            onDragOver={(e) => {
              if (draggedKey && draggedKey !== h.key) {
                e.preventDefault()
                e.stopPropagation()
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (draggedKey && draggedKey !== h.key) onPlace(draggedKey, sectionKey, h.key, hidden)
              setDraggedKey(null)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              cursor: 'grab',
              fontSize: '0.8125rem',
              padding: '0.25rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: hidden ? 'var(--color-surface)' : 'var(--color-bg-subtle)',
              color: hidden ? 'var(--color-text-muted)' : 'var(--color-text)',
              opacity: draggedKey === h.key ? 0.5 : 1,
            }}
          >
            <span aria-hidden style={{ color: 'var(--color-text-muted)' }}>⠿</span>
            {displayName(h)}
          </span>
        ))
      )}
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
