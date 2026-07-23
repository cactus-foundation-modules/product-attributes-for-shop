'use client'

import { useEffect, useState } from 'react'

type PatSettings = {
  hideEmptyValues: boolean
  includeVariantValues: boolean
}

const TOGGLES: Array<{ key: keyof PatSettings; label: string; hint: string }> = [
  {
    key: 'hideEmptyValues',
    label: 'Hide filter options that match nothing',
    hint: 'Keeps the filter list tidy by leaving out any option that would bring back no products at all.',
  },
  {
    key: 'includeVariantValues',
    label: 'Count options that only appear on a product variant',
    hint: 'Some options live on a particular size or colour rather than on the product itself. Leave this on to have shoppers find those products by filtering. Turn it off to filter on the main product details only.',
  },
]

export function ProductAttributesSettingsTab() {
  const [settings, setSettings] = useState<PatSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/m/product-attributes-for-shop/admin/settings')
      .then((r) => r.json())
      .then((d: { settings?: PatSettings }) => {
        if (d.settings) setSettings(d.settings)
      })
      .catch(() => setError('Could not load these settings. Please refresh the page.'))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!settings) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch('/api/m/product-attributes-for-shop/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not save these settings.')
      } else {
        if (data.settings) setSettings(data.settings)
        setSaved(true)
      }
    } catch {
      setError('Could not save these settings.')
    }
    setSaving(false)
  }

  if (!settings) {
    return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
  }

  return (
    <form onSubmit={save}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        How the product filters behave on your shop pages.
      </p>

      {TOGGLES.map((t) => (
        <div key={t.key} style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings[t.key]}
              onChange={(e) => {
                setSaved(false)
                setSettings({ ...settings, [t.key]: e.target.checked })
              }}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              <span style={{ display: 'block', color: 'var(--color-text)' }}>{t.label}</span>
              <span style={{ display: 'block', fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                {t.hint}
              </span>
            </span>
          </label>
        </div>
      ))}

      {error && <p style={{ color: 'var(--color-error)', marginBottom: '1rem' }}>{error}</p>}
      {saved && !error && <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>Saved.</p>}

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  )
}
