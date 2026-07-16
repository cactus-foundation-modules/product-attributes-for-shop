'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PatAttributeWithValues, PatControlType } from '@/modules/product-attributes-for-shop/lib/types'

const CONTROL_LABELS: Record<PatControlType, string> = {
  CHECKBOX: 'Tick list',
  SWATCH: 'Colour swatches',
  DROPDOWN: 'Dropdown',
}

// The shop-wide attribute vocabulary: what can be filtered by, and which values
// each one offers. Products are attached to values from their own editor, not
// here, so this screen is purely about defining the vocabulary.
export function AttributesScreen() {
  const [attributes, setAttributes] = useState<PatAttributeWithValues[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newControl, setNewControl] = useState<PatControlType>('CHECKBOX')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/m/product-attributes-for-shop/admin/attributes')
      const data = await res.json()
      setAttributes(data.attributes ?? [])
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

  return (
    <div>
      <div className="page-header"><h1 className="page-title">Product attributes</h1></div>

      <p style={{ color: 'var(--color-text-muted)', marginTop: 0 }}>
        Attributes are the things shoppers filter by - Material, Colour, Room, and so on. Define them here,
        then tick the ones that apply from each product&rsquo;s own editor.
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

      {!loaded ? null : attributes.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No attributes yet. Add one above to get started.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {attributes.map((attribute) => (
            <AttributeCard key={attribute.id} attribute={attribute} busy={busy} send={send} />
          ))}
        </div>
      )}
    </div>
  )
}

function AttributeCard({
  attribute,
  busy,
  send,
}: {
  attribute: PatAttributeWithValues
  busy: boolean
  send: (url: string, method: string, body?: unknown) => Promise<boolean>
}) {
  const [newValue, setNewValue] = useState('')
  const [newSwatch, setNewSwatch] = useState('#888888')
  const base = '/api/m/product-attributes-for-shop/admin'
  const isSwatch = attribute.controlType === 'SWATCH'

  async function addValue() {
    const label = newValue.trim()
    if (!label) return
    const ok = await send(`${base}/attributes/${attribute.id}/values`, 'POST', {
      label,
      swatch: isSwatch ? newSwatch : null,
    })
    if (ok) setNewValue('')
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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
            {value.swatch && (
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: value.swatch, border: '1px solid var(--color-border)' }} />
            )}
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
        <button className="btn btn-secondary" disabled={busy || !newValue.trim()} onClick={() => void addValue()}>Add value</button>
      </div>
    </section>
  )
}
