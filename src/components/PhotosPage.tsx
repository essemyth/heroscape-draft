import { useState } from 'react'
import { collections, unitIndex } from '../lib/data'
import { claimPhotoEditor, usePhotoEditor, useUnitPhotos } from '../lib/photos'
import type { Unit } from '../lib/types'
import { GeneralBadge } from './GeneralBadge'
import { PhotoButtons, UnitThumb } from './PhotoControls'

interface Props {
  me: string
  navigate: (path: string) => void
}

// Every unit in any imported collection, grouped by general.
const ownedUnits: Unit[] = [...new Set(Object.values(collections).flatMap((c) => Object.keys(c)))]
  .map((id) => unitIndex.get(id))
  .filter((u): u is Unit => Boolean(u))
  .sort((a, b) => a.general.localeCompare(b.general) || a.name.localeCompare(b.name))

export function PhotosPage({ me, navigate }: Props) {
  const [isEditor, recheck] = usePhotoEditor(me)
  const photoOf = useUnitPhotos()
  const [missingOnly, setMissingOnly] = useState(true)
  const [search, setSearch] = useState('')

  const done = ownedUnits.filter((u) => photoOf(u.id)).length
  const q = search.trim().toLowerCase()
  const shown = ownedUnits.filter((u) => (!missingOnly || !photoOf(u.id)) && (!q || u.name.toLowerCase().includes(q)))

  return (
    <div className="lobby photos-page">
      <header className="lobby-header">
        <button type="button" className="link-btn back" onClick={() => navigate('/')}>
          ← Home
        </button>
        <h1>Unit photos</h1>
        <p className="muted">
          <strong>{done}</strong> of {ownedUnits.length} units have photos.
        </p>
        <div className="points-bar" role="meter" aria-valuemin={0} aria-valuemax={ownedUnits.length} aria-valuenow={done}>
          <div className="points-fill" style={{ width: `${(done / Math.max(1, ownedUnits.length)) * 100}%` }} />
        </div>
      </header>

      {!isEditor && <UnlockForm onUnlocked={recheck} />}

      <section className="panel">
        <div className="pool-filters">
          <input type="search" className="search" placeholder="Search units…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
            Missing photos only
          </label>
        </div>
        {shown.length === 0 && <p className="muted">{missingOnly ? 'Every unit has a photo. 🎉' : 'No units match.'}</p>}
        <ul className="photo-list">
          {shown.map((u) => (
            <li key={u.id}>
              <UnitThumb unit={u} />
              <span className="photo-list-name">
                <GeneralBadge general={u.general} size={18} />
                {u.name}
              </span>
              {isEditor && <PhotoButtons unit={u} hasPhoto={Boolean(photoOf(u.id))} compact />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (await claimPhotoEditor(code)) onUnlocked()
      else setError("That code isn't right.")
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel">
      <h2>Add photos from this device</h2>
      <p className="muted">Enter the photo code once on each phone or computer you'll take photos with.</p>
      <div className="button-row">
        <input
          className="grow"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Photo code"
          autoCapitalize="none"
          autoCorrect="off"
          onKeyDown={(e) => e.key === 'Enter' && code.trim() && submit()}
        />
        <button type="button" className="primary" disabled={!code.trim() || busy} onClick={submit}>
          Unlock
        </button>
      </div>
      {error && <p className="warn">{error}</p>}
    </section>
  )
}
