'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PatAttributeGroup, PatAttributeWithValues, PatControlType } from '@/modules/product-attributes-for-shop/lib/types'
import { isImageSwatch } from '@/modules/product-attributes-for-shop/lib/types'
import { SwatchImagePicker } from '@/modules/product-attributes-for-shop/components/admin/SwatchImagePicker'

const CONTROL_LABELS: Record<PatControlType, string> = {
  CHECKBOX: 'Tick list',
  SWATCH: 'Colour swatches',
  DROPDOWN: 'Dropdown',
  IMAGE: 'Picture swatches',
}

// The shop-wide attribute vocabulary: what can be filtered by, and which values
// each one offers. Products are attached to values from their own editor, not
// here, so this screen is purely about defining the vocabulary.
export function AttributesScreen() {
  const [attributes, setAttributes] = useState<PatAttributeWithValues[]>([])
  const [groups, setGroups] = useState<PatAttributeGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newControl, setNewControl] = useState<PatControlType>('CHECKBOX')
  const [newGroupName, setNewGroupName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [attrRes, groupRes] = await Promise.all([
        fetch('/api/m/product-attributes-for-shop/admin/attributes'),
        fetch('/api/m/product-attributes-for-shop/admin/groups'),
      ])
      const attrData = await attrRes.json()
      const groupData = await groupRes.json()
      setAttributes(attrData.attributes ?? [])
      setGroups(groupData.groups ?? [])
    } catch {
      setError('Could not load attributes.')
    } finally {
      setLoaded(true)
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- delegating to async helper; all setState calls are after awaits
  useEffect(() => { void load() }, [load])

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong.')
        return false
      }
      await load()
      return true
    } catch {
      setError('Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addAttribute() {
    const name = newName.trim()
    if (!name) return
    const ok = await send('/api/m/product-attributes-for-shop/admin/attributes', 'POST', { name, controlType: newControl })
    if (ok) { setNewName(''); setNewControl('CHECKBOX') }
  }

  async function addGroup() {
    const name = newGroupName.trim()
    if (!name) return
    const ok = await send('/api/m/product-attributes-for-shop/admin/groups', 'POST', { name })
    if (ok) setNewGroupName('')
  }

  // One section per group, in the owner's order, then whatever is still loose.
  // The ungrouped section is only drawn when it has something in it: on a shop
  // that has filed everything away, an empty "Not in a group" heading would be
  // a permanent reminder of nothing.
  const sections = [
    ...groups.map((group) => ({ group, items: attributes.filter((a) => a.groupId === group.id) })),
    { group: null, items: attributes.filter((a) => !a.groupId || !groups.some((g) => g.id === a.groupId)) },
  ].filter((section) => section.group !== null || section.items.length > 0)

  // Reordering sends the whole running order back, never "move this one". The
  // attribute order is global (it is the order the shop's filters appear in), so
  // a swap inside one group is flattened against every other section first -
  // otherwise moving something inside "Materials" could quietly leapfrog it past
  // an attribute in a different group on the storefront.
  async function moveAttribute(sectionIndex: number, itemIndex: number, delta: number) {
    const section = sections[sectionIndex]
    if (!section) return
    const items = [...section.items]
    const moved = items[itemIndex]
    const displaced = items[itemIndex + delta]
    if (!moved || !displaced) return
    items[itemIndex] = displaced
    items[itemIndex + delta] = moved
    const ids = sections.flatMap((s, i) => (i === sectionIndex ? items : s.items)).map((a) => a.id)
    await send('/api/m/product-attributes-for-shop/admin/attributes/reorder', 'POST', { ids })
  }

  async function moveGroup(index: number, delta: number) {
    const next = [...groups]
    const moved = next[index]
    const displaced = next[index + delta]
    if (!moved || !displaced) return
    next[index] = displaced
    next[index + delta] = moved
    await send('/api/m/product-attributes-for-shop/admin/groups/reorder', 'POST', { ids: next.map((g) => g.id) })
  }

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Product attributes</h1></div>

      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
        Attributes are the things shoppers filter by - Material, Colour, Room, and so on. Define them here,
        then tick the ones that apply from each product&rsquo;s own editor. The arrows set the order shoppers
        see the filters in.
      </p>

      {error && <div className="alert alert-danger" role="alert">{error}</div>}

      <section style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Add an attribute</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-control"
            style={{ flex: '1 1 14rem', minWidth: '10rem' }}
            placeholder="e.g. Material"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addAttribute() }}
            aria-label="Attribute name"
          />
          <select
            className="form-control"
            style={{ flex: '0 0 12rem' }}
            value={newControl}
            onChange={(e) => setNewControl(e.target.value as PatControlType)}
            aria-label="How shoppers pick it"
          >
            {(Object.keys(CONTROL_LABELS) as PatControlType[]).map((k) => (
              <option key={k} value={k}>{CONTROL_LABELS[k]}</option>
            ))}
          </select>
          <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={() => void addAttribute()}>Add</button>
        </div>
      </section>

      <section style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Add a group</h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
          Groups only tidy up this screen - shoppers still see every attribute you have ticked for filters,
          in the same order. Any picture swatches move to match when you file an attribute away.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-control"
            style={{ flex: '1 1 14rem', minWidth: '10rem' }}
            placeholder="e.g. Materials and finishes"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addGroup() }}
            aria-label="Group name"
          />
          <button className="btn btn-secondary" disabled={busy || !newGroupName.trim()} onClick={() => void addGroup()}>Add group</button>
        </div>
      </section>

      {!loaded ? null : attributes.length === 0 && groups.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No attributes yet. Add one above to get started.</p>
      ) : (
        <div style={{ display: 'grid', gap: '2rem' }}>
          {sections.map((section, sectionIndex) => (
            <div key={section.group?.id ?? 'ungrouped'}>
              <GroupHeader
                group={section.group}
                count={section.items.length}
                busy={busy}
                send={send}
                groupIndex={section.group ? groups.findIndex((g) => g.id === section.group?.id) : -1}
                groupCount={groups.length}
                onMove={moveGroup}
              />
              {section.items.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>
                  Nothing in this group yet. Move an attribute in with its Group dropdown.
                </p>
              ) : (
                <div style={{ display: 'grid', gap: '1rem' }}>
                  {section.items.map((attribute, itemIndex) => (
                    <AttributeCard
                      key={attribute.id}
                      attribute={attribute}
                      groups={groups}
                      busy={busy}
                      send={send}
                      canMoveUp={itemIndex > 0}
                      canMoveDown={itemIndex < section.items.length - 1}
                      onMove={(delta) => moveAttribute(sectionIndex, itemIndex, delta)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Up/down rather than drag-and-drop: it is keyboard-reachable and screen-reader
// announceable for free, and the lists here are short enough that a drag would
// be the fussier of the two.
function MoveButtons({
  label,
  canMoveUp,
  canMoveDown,
  busy,
  onMove,
}: {
  label: string
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
  onMove: (delta: number) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-label={`Move ${label} up`}
        disabled={busy || !canMoveUp}
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-label={`Move ${label} down`}
        disabled={busy || !canMoveDown}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
    </div>
  )
}

function GroupHeader({
  group,
  count,
  busy,
  send,
  groupIndex,
  groupCount,
  onMove,
}: {
  group: PatAttributeGroup | null
  count: number
  busy: boolean
  send: (url: string, method: string, body?: unknown) => Promise<boolean>
  groupIndex: number
  groupCount: number
  onMove: (index: number, delta: number) => Promise<void>
}) {
  const base = '/api/m/product-attributes-for-shop/admin'

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', margin: '0 0 0.75rem' }}>
      <h2 style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)', margin: 0 }}>
        {group ? group.name : 'Not in a group'}
      </h2>
      {group && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <MoveButtons
            label={`the ${group.name} group`}
            canMoveUp={groupIndex > 0}
            canMoveDown={groupIndex < groupCount - 1}
            busy={busy}
            onMove={(delta) => void onMove(groupIndex, delta)}
          />
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => {
              const next = prompt('Rename this group to:', group.name)?.trim()
              if (next && next !== group.name) void send(`${base}/groups/${group.id}`, 'PATCH', { name: next })
            }}
          >
            Rename
          </button>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => {
              const warning = count === 0
                ? `Delete the "${group.name}" group?`
                : `Delete the "${group.name}" group? Its ${count} attribute${count === 1 ? '' : 's'} stay put, just ungrouped.`
              if (confirm(warning)) void send(`${base}/groups/${group.id}`, 'DELETE')
            }}
          >
            Delete group
          </button>
        </div>
      )}
    </div>
  )
}

function AttributeCard({
  attribute,
  groups,
  busy,
  send,
  canMoveUp,
  canMoveDown,
  onMove,
}: {
  attribute: PatAttributeWithValues
  groups: PatAttributeGroup[]
  busy: boolean
  send: (url: string, method: string, body?: unknown) => Promise<boolean>
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (delta: number) => Promise<void>
}) {
  const [newValue, setNewValue] = useState('')
  const [newSwatch, setNewSwatch] = useState('#888888')
  const [newImage, setNewImage] = useState<string | null>(null)
  const base = '/api/m/product-attributes-for-shop/admin'
  const isSwatch = attribute.controlType === 'SWATCH'
  const isImage = attribute.controlType === 'IMAGE'

  async function addValue() {
    const label = newValue.trim()
    if (!label) return
    const ok = await send(`${base}/attributes/${attribute.id}/values`, 'POST', {
      label,
      swatch: isSwatch ? newSwatch : isImage ? newImage : null,
    })
    // The picture is cleared alongside the label: it belonged to the value just
    // added, and leaving it loaded would quietly give the next value the same one.
    if (ok) { setNewValue(''); setNewImage(null) }
  }

  return (
    <section style={{ border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '0.9375rem', margin: 0 }}>
            {attribute.name}
            <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '0.5rem', fontSize: '0.8125rem' }}>
              {CONTROL_LABELS[attribute.controlType]}
            </span>
          </h3>
          {attribute.sourceOptionName && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              Imported from the &ldquo;{attribute.sourceOptionName}&rdquo; variation option.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <MoveButtons
            label={attribute.name}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            busy={busy}
            onMove={(delta) => void onMove(delta)}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>Group</span>
            <select
              className="form-control"
              style={{ width: 'auto', fontSize: '0.8125rem', padding: '0.25rem 0.5rem' }}
              value={attribute.groupId ?? ''}
              disabled={busy}
              onChange={(e) => void send(`${base}/attributes/${attribute.id}`, 'PATCH', { groupId: e.target.value || null })}
            >
              <option value="">Not in a group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem' }}>
            <input
              type="checkbox"
              checked={attribute.showInFilters}
              disabled={busy}
              onChange={(e) => void send(`${base}/attributes/${attribute.id}`, 'PATCH', { showInFilters: e.target.checked })}
            />
            Show in filters
          </label>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => {
              if (confirm(`Delete "${attribute.name}"? Every product loses this attribute.`)) {
                void send(`${base}/attributes/${attribute.id}`, 'DELETE')
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
        {attribute.values.length === 0 && (
          <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No values yet.</span>
        )}
        {attribute.values.map((value) => (
          <span
            key={value.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              fontSize: '0.8125rem',
              padding: '0.125rem 0.5rem',
              borderRadius: 999,
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
            }}
          >
            {isImage ? (
              <SwatchImagePicker
                attributeId={attribute.id}
                value={value.swatch && isImageSwatch(value.swatch) ? value.swatch : null}
                label={value.label}
                disabled={busy}
                size={18}
                onPick={(url) => send(`${base}/values/${value.id}`, 'PATCH', { swatch: url }).then(() => undefined)}
              />
            ) : value.swatch ? (
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: value.swatch, border: '1px solid var(--color-border)' }} />
            ) : null}
            {value.label}
            <button
              type="button"
              aria-label={`Delete ${value.label}`}
              disabled={busy}
              onClick={() => void send(`${base}/values/${value.id}`, 'DELETE')}
              style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, lineHeight: 1 }}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="form-control"
          style={{ flex: '1 1 12rem', minWidth: '8rem' }}
          placeholder="Add a value, e.g. Oak"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addValue() }}
          aria-label={`New value for ${attribute.name}`}
        />
        {isSwatch && (
          <input
            type="color"
            className="form-control"
            style={{ flex: '0 0 3.5rem', padding: '0.125rem' }}
            value={newSwatch}
            onChange={(e) => setNewSwatch(e.target.value)}
            aria-label={`Colour for the new ${attribute.name} value`}
          />
        )}
        {isImage && (
          <SwatchImagePicker
            attributeId={attribute.id}
            value={newImage}
            label={`the new ${attribute.name} value`}
            disabled={busy}
            size={28}
            onPick={(url) => setNewImage(url)}
          />
        )}
        <button className="btn btn-secondary" disabled={busy || !newValue.trim()} onClick={() => void addValue()}>Add value</button>
      </div>
    </section>
  )
}
