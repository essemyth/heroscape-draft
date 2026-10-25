import { useRef, useState } from 'react'
import { uploadUnitPhoto, useUnitPhotos } from '../lib/photos'
import type { Unit } from '../lib/types'

/** "Add photo" (opens the camera) plus "choose from library", with upload progress. */
export function PhotoButtons({ unit, hasPhoto, compact = false }: { unit: Unit; hasPhoto: boolean; compact?: boolean }) {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      {error && <span className="warn photo-error">{error}</span>}
    </span>
  )
}

/** The large photo in a unit's details, or a placeholder; editors get the add/replace buttons. */
export function UnitPhotoView({ unit, canEdit }: { unit: Unit; canEdit: boolean }) {
  const photo = useUnitPhotos()(unit.id)
  return (
    <div className="unit-photo-wrap">
      {photo ? (
        <img className="unit-photo" src={photo.url} alt={unit.name} />
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
  return photo ? (
    <img className="unit-thumb" src={photo.thumbUrl} alt="" loading="lazy" />
  ) : (
    <span className="unit-thumb placeholder" aria-hidden="true">
      📷
    </span>
  )
}
