'use client'

import { useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'

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

// A sub-tab of shop's settings tab rather than a top-level Settings tab, hosted
// through the 'shop.settings-sub-tabs' slot (manifest `host`). Shop lends the
// space and nothing else: own fetch, own save, own permission, own module API.
// Shop's "Save settings" button stands down while this is showing.
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

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
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
      <div className="card settings-fields">
        <h3 className="card-title">Filters on shop pages</h3>
        {TOGGLES.map((t) => (
          <div key={t.key}>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings[t.key]}
                onChange={(e) => {
                  setSaved(false)
                  setSettings({ ...settings, [t.key]: e.target.checked })
                }}
              />
              {t.label}
            </label>
            <p className="field-hint" style={{ margin: '0.25rem 0 0 1.75rem' }}>{t.hint}</p>
          </div>
        ))}
      </div>

      {error && <p style={{ color: 'var(--color-error)', marginBottom: '1rem' }}>{error}</p>}

      <SettingsHeaderActions>
        <SettingsHeaderStatus message={saved ? 'Saved' : null} error={error} />
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </SettingsHeaderActions>
    </form>
  )
}
