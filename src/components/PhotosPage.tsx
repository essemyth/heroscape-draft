import { useRef, useState } from 'react'
import { BackupError, type ReadBackup } from '../lib/backup-format'
import { downloadPhotoBackup, inspectBackup, restorePhotoBackup, type RestoreResult } from '../lib/backup'
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
      {isEditor && <BackupPanel photoCount={done} />}

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

/** Download all photos as a zip, or restore them from one. Only shown on code-unlocked devices. */
function BackupPanel({ photoCount }: { photoCount: number }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [backup, setBackup] = useState<ReadBackup | null>(null)
  const [onlyMissing, setOnlyMissing] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = async (label: string, task: () => Promise<string>) => {
    setBusy(label)
    setError(null)
    setMessage(null)
    try {
      setMessage(await task())
    } catch (e) {
      setError(e instanceof BackupError || e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  const download = () =>
    run('Downloading', async () => {
      const count = await downloadPhotoBackup((done, total) => setProgress([done, total]))
      return `Saved a backup of ${count} photos. Keep it somewhere safe, like cloud storage.`
    })

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setMessage(null)
    try {
      setBackup(await inspectBackup(file))
    } catch (e) {
      setBackup(null)
      setError(e instanceof Error ? e.message : 'Could not read that file')
    }
  }

  const restore = () => {
    if (!backup) return
    const what = onlyMissing ? 'units that have no photo yet' : `all ${backup.entries.length} units in the backup, replacing their current photos`
    if (!window.confirm(`Restore photos for ${what}?`)) return
    run('Restoring', async () => {
      const r: RestoreResult = await restorePhotoBackup(backup, onlyMissing, (done, total) => setProgress([done, total]))
      setBackup(null)
      const failed = r.failed.length ? ` ${r.failed.length} failed: ${r.failed.map((f) => f.name).join(', ')}.` : ''
      return `Restored ${r.restored}, skipped ${r.skipped}.${failed}`
    })
  }

  return (
    <section className="panel backup-panel">
      <h2>Backup &amp; restore</h2>
      <p className="muted">
        Download every photo and thumbnail as one zip file, and keep it somewhere safe. If photos are ever lost, restore them from
        that file.
      </p>

      <div className="button-row">
        <button type="button" className="primary" disabled={!!busy || photoCount === 0} onClick={download}>
          ⬇ Download backup ({photoCount} photos)
        </button>
        <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}>
          ⬆ Restore from backup…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            pickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {backup && !busy && (
        <div className="restore-confirm">
          <p>
            Backup from <strong>{new Date(backup.manifest.createdAt).toLocaleString()}</strong> with{' '}
            <strong>{backup.entries.length}</strong> photos
            {backup.unknown.length > 0 && <span className="muted"> ({backup.unknown.length} for units this app doesn't know will be skipped)</span>}.
          </p>
          <label className="check">
            <input type="radio" name="restore-mode" checked={onlyMissing} onChange={() => setOnlyMissing(true)} />
            Only units missing a photo
          </label>
          <label className="check">
            <input type="radio" name="restore-mode" checked={!onlyMissing} onChange={() => setOnlyMissing(false)} />
            Replace all photos in the backup
          </label>
          <div className="button-row">
            <button type="button" className="primary" onClick={restore}>
              Restore
            </button>
            <button type="button" onClick={() => setBackup(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && progress && (
        <div className="backup-progress" aria-live="polite">
          <span>
            {busy} {progress[0]} / {progress[1]}…
          </span>
          <div className="points-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress[1]} aria-valuenow={progress[0]}>
            <div className="points-fill" style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%` }} />
          </div>
        </div>
      )}
      {message && <p className="backup-message">{message}</p>}
      {error && <p className="warn">{error}</p>}
    </section>
  )
}
