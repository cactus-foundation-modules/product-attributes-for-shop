'use client'

import { useCallback, useState } from 'react'
import { MediaPickerModal } from '@/modules/shop/components/admin/MediaPickerModal'
import { uploadOneFile } from '@/lib/media/upload-client'
import { preflightUploadError } from '@/lib/media/limits'

const BASE = '/api/m/product-attributes-for-shop/admin'

// The picture behind an image-swatch value: the same job the colour input does
// for a SWATCH attribute, in a different medium. Clicking the thumbnail opens
// the shared media library, which carries its own upload button, so a picture
// nobody has uploaded yet and one that is already filed are the same two clicks
// apart. A picture dropped straight onto the box is the same trip by a shorter
// route.
//
// There is no hand-typed equivalent of the hex box, so there is no draft to
// hold: the library hands back a url or the admin cancels, and the pick itself
// is the change. A value with no picture shows a dashed box, matching the dashed
// dot an uncoloured swatch shows, and the storefront falls back to the label.
export function SwatchImagePicker({ attributeId, value, label, onPick, disabled, size = 22 }: {
  attributeId: string
  value: string | null
  label: string
  onPick: (url: string) => void | Promise<void>
  disabled?: boolean
  size?: number
}) {
  const [picking, setPicking] = useState(false)
  const [working, setWorking] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Browsing opens where this attribute's pictures already live without creating
  // anything; an upload asks for the folder proper, so the file lands beside its
  // siblings rather than loose in the library root. Two endpoints, one route.
  const resolveBrowseFolderId = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${BASE}/attributes/${attributeId}/media-folder`)
      if (!res.ok) return null
      return (await res.json()).folderId ?? null
    } catch {
      return null
    }
  }, [attributeId])

  const resolveUploadFolderId = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${BASE}/attributes/${attributeId}/media-folder`, { method: 'POST' })
      if (!res.ok) return null
      return (await res.json()).folderId ?? null
    } catch {
      return null
    }
  }, [attributeId])

  async function choose(url: string) {
    setPicking(false)
    if (url === value) return
    setWorking(true)
    try {
      await onPick(url)
    } finally {
      setWorking(false)
    }
  }

  async function receiveDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    // The same rules the library applies, checked here so a wrong file type or an
    // oversized photo says so at once rather than after the round trip.
    const reason = preflightUploadError(file)
    if (reason) { setError(reason); return }
    setError(null)
    setWorking(true)
    try {
      const media = await uploadOneFile(file, await resolveUploadFolderId())
      await onPick(media.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image would not upload.')
    } finally {
      setWorking(false)
    }
  }

  const busy = disabled || working
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
      <button
        type="button"
        aria-label={value ? `Change the picture for ${label}, or drop an image here` : `Set a picture for ${label}, or drop an image here`}
        title="Click to choose from the library, or drop an image here"
        disabled={busy}
        onClick={() => setPicking(true)}
        onDragEnter={(e) => { if (!busy && isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
        onDragOver={(e) => { if (!busy && isFileDrag(e)) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { if (!busy && isFileDrag(e)) void receiveDrop(e) }}
        style={{
          width: size, height: size, padding: 0, flexShrink: 0, overflow: 'hidden',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'var(--radius-md)',
          background: dragOver ? 'var(--color-primary-subtle)' : 'none',
          cursor: busy ? 'progress' : 'pointer',
          border: dragOver
            ? '2px solid var(--color-primary)'
            : value ? '1px solid var(--color-border)' : '1px dashed var(--color-text-muted)',
        }}
      >
        {working ? (
          <span aria-hidden style={{ fontSize: '0.625rem', lineHeight: 1, color: 'var(--color-text-muted)' }}>…</span>
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader
          <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <span aria-hidden style={{ fontSize: '0.625rem', lineHeight: 1, color: dragOver ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>＋</span>
        )}
      </button>
      {error && (
        <span role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.6875rem', maxWidth: 160, lineHeight: 1.3 }}>{error}</span>
      )}
      {picking && (
        <MediaPickerModal
          resolveFolderId={resolveUploadFolderId}
          resolveInitialFolderId={resolveBrowseFolderId}
          onClose={() => setPicking(false)}
          onAdd={(items) => {
            // One value, one picture: the library picks in multiples, so the first
            // of a multi-select wins.
            const first = items[0]
            if (first) void choose(first.url)
            else setPicking(false)
          }}
        />
      )}
    </span>
  )
}

// A reorder drag carries no files, so this keeps those from lighting the box up.
function isFileDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}
