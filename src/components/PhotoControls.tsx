import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isUploaded, uploadUnitPhoto, useUnitPhotos } from '../lib/photos'
import type { Unit } from '../lib/types'
import { ThumbnailEditor } from './ThumbnailEditor'

/** "Add photo" (opens the camera) plus "choose from library", with upload progress. */
export function PhotoButtons({ unit, hasPhoto, compact = false }: { unit: Unit; hasPhoto: boolean; compact?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cropping, setCropping] = useState(false)
  const photo = useUnitPhotos()(unit.id)

  const onFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = '' // allow picking the same file again
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await uploadUnitPhoto(unit.id, file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`photo-buttons ${compact ? 'compact' : ''}`}>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target)} />
      <input ref={library} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target)} />
      <button type="button" className="primary" disabled={busy} onClick={() => camera.current?.click()}>
        {busy ? 'Uploading…' : hasPhoto ? '📷 Replace photo' : '📷 Add photo'}
      </button>
      <button type="button" className="link-btn" disabled={busy} onClick={() => library.current?.click()}>
        {compact ? 'Library' : 'or choose from library'}
      </button>
      {photo && isUploaded(unit.id) && (
        <button type="button" disabled={busy} onClick={() => setCropping(true)}>
          ✂️ {compact ? 'Thumbnail' : 'Edit thumbnail'}
        </button>
      )}
      {error && <span className="warn photo-error">{error}</span>}
      {cropping && photo && <ThumbnailEditor unit={unit} photoUrl={photo.url} onClose={() => setCropping(false)} />}
    </span>
  )
}

/** The large photo in a unit's details, or a placeholder; editors get the add/replace buttons. */
export function UnitPhotoView({ unit, canEdit }: { unit: Unit; canEdit: boolean }) {
  const photo = useUnitPhotos()(unit.id)
  return (
    <div className="unit-photo-wrap">
      {photo ? (
        <RetryingImg key={photo.url} className="unit-photo" src={photo.url} alt={unit.name} />
      ) : (
        <div className="unit-photo placeholder">
          <span>{unit.name}</span>
          <span className="muted">No photo yet</span>
        </div>
      )}
      {canEdit && <PhotoButtons unit={unit} hasPhoto={Boolean(photo)} />}
    </div>
  )
}

/** Small photo for list rows; a placeholder until a photo exists. */
export function UnitThumb({ unit }: { unit: Unit }) {
  const photo = useUnitPhotos()(unit.id)
  const placeholder = (
    <span className="unit-thumb placeholder" aria-hidden="true">
      📷
    </span>
  )
  return photo ? <RetryingImg key={photo.thumbUrl} className="unit-thumb" src={photo.thumbUrl} alt="" lazy fallback={placeholder} /> : placeholder
}

const MAX_RETRIES = 4

/**
 * An <img> that retries after a failed load (with a short, growing pause) instead of
 * staying blank, which happens when many photos load at once on a slow connection.
 * Shows a shimmer until it arrives. Render with key={src} so a new photo starts fresh.
 */
function RetryingImg({ src, className, alt, lazy = false, fallback = null }: { src: string; className: string; alt: string; lazy?: boolean; fallback?: ReactNode }) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (gaveUp) return <>{fallback}</>
  // A query string on retries makes the browser fetch again rather than reuse the failure.
  const url = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
  return (
    <img
      className={`${className} ${loaded ? '' : 'loading'}`}
      src={url}
      alt={alt}
      loading={lazy ? 'lazy' : undefined}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (attempt >= MAX_RETRIES) setGaveUp(true)
        else timer.current = setTimeout(() => setAttempt((a) => a + 1), 600 * 2 ** attempt)
      }}
    />
  )
}
