// The photo backup zip format. Pure functions (no browser or server APIs), so the same
// code reads and writes backups on today's site and on the self-hosted one.
//
// heroscape-photos-<date>.zip
//   manifest.json          { format, version, createdAt, count, units: [...] }
//   photos/<unitId>.<ext>  full photo (800x500)
//   thumbs/<unitId>.<ext>  thumbnail (320x200, keeps custom crops)

import { unzipSync, zipSync } from 'fflate'

export const BACKUP_FORMAT = 'heroscape-photos'
export const BACKUP_VERSION = 1

export interface BackupImage {
  bytes: Uint8Array
  /** "webp" or "jpg". */
  ext: string
}

export interface BackupEntry {
  unitId: string
  name: string
  photo: BackupImage
  thumb: BackupImage
}

interface ManifestUnit {
  unitId: string
  name: string
  photo: string
  thumb: string
}

export interface BackupManifest {
  format: string
  version: number
  createdAt: string
  count: number
  units: ManifestUnit[]
}

export function buildBackupZip(entries: BackupEntry[], createdAt: string): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const units: ManifestUnit[] = []
  for (const e of entries) {
    const photo = `photos/${e.unitId}.${e.photo.ext}`
    const thumb = `thumbs/${e.unitId}.${e.thumb.ext}`
    files[photo] = e.photo.bytes
    files[thumb] = e.thumb.bytes
    units.push({ unitId: e.unitId, name: e.name, photo, thumb })
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt, count: units.length, units }
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  // Images are already compressed; storing them avoids wasted work.
  return zipSync(files, { level: 0 })
}

export class BackupError extends Error {}

export interface ReadBackup {
  manifest: BackupManifest
  entries: BackupEntry[]
  /** Units in the backup that this app doesn't know about (skipped). */
  unknown: string[]
}

/** Reads and checks a backup zip. Units not in `knownUnitIds` are reported, not returned. */
export function readBackupZip(bytes: Uint8Array, knownUnitIds: Set<string>): ReadBackup {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new BackupError("That file isn't a zip file.")
  }

  const raw = files['manifest.json']
  if (!raw) throw new BackupError("That zip isn't a HeroScape photo backup (no manifest.json).")
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new BackupError('The backup manifest is damaged.')
  }
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError("That zip isn't a HeroScape photo backup.")
  if (manifest.version > BACKUP_VERSION) throw new BackupError('That backup was made by a newer version of the app.')
  if (!Array.isArray(manifest.units)) throw new BackupError('The backup manifest is damaged.')

  const ext = (path: string) => path.split('.').pop() ?? 'webp'
  const entries: BackupEntry[] = []
  const unknown: string[] = []
  for (const u of manifest.units) {
    if (!knownUnitIds.has(u.unitId)) {
      unknown.push(u.unitId)
      continue
    }
    const photo = files[u.photo]
    const thumb = files[u.thumb]
    if (!photo || !thumb) throw new BackupError(`The backup is missing files for ${u.name || u.unitId}.`)
    entries.push({ unitId: u.unitId, name: u.name, photo: { bytes: photo, ext: ext(u.photo) }, thumb: { bytes: thumb, ext: ext(u.thumb) } })
  }
  return { manifest, entries, unknown }
}

export const mimeOf = (ext: string) => (ext === 'webp' ? 'image/webp' : 'image/jpeg')
export const extOf = (mime: string) => (mime === 'image/webp' ? 'webp' : 'jpg')
