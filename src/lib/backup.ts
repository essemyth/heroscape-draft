// Download and restore unit photo backups (see backup-format.ts for the zip layout).

import { unitIndex } from './data'
import { buildBackupZip, extOf, mimeOf, readBackupZip, type BackupEntry, type ReadBackup } from './backup-format'
import { loadPhotoRows, photoRows, publicUrl, uploadPhotoFiles } from './photos'

export type Progress = (done: number, total: number) => void

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; ext: string }> {
  // A few tries, since a backup fetches hundreds of files at once.
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: extOf(blob.type || res.headers.get('content-type') || '') }
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw lastError
}

/** Runs `task` over `items`, a few at a time, reporting progress. */
async function eachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>, onProgress: Progress) {
  let next = 0
  let done = 0
  onProgress(0, items.length)
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
      onProgress(++done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** Fetches every uploaded photo and thumbnail and saves them as one zip file. Returns how many units it holds. */
export async function downloadPhotoBackup(onProgress: Progress): Promise<number> {
  const rows = await loadPhotoRows()
  const entries: BackupEntry[] = []
  await eachLimited(
    rows,
    6,
    async (row) => {
      const [photo, thumb] = await Promise.all([fetchImage(publicUrl(row.path)), fetchImage(publicUrl(row.thumb_path))])
      entries.push({ unitId: row.unit_id, name: unitIndex.get(row.unit_id)?.name ?? row.unit_id, photo, thumb })
    },
    onProgress,
  )
  entries.sort((a, b) => a.name.localeCompare(b.name))

  const now = new Date()
  const zip = buildBackupZip(entries, now.toISOString())
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `heroscape-photos-${now.toISOString().slice(0, 10)}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return entries.length
}

/** Reads a backup file and checks it, without changing anything. */
export async function inspectBackup(file: File): Promise<ReadBackup> {
  return readBackupZip(new Uint8Array(await file.arrayBuffer()), new Set(unitIndex.keys()))
}

export interface RestoreResult {
  restored: number
  skipped: number
  failed: { name: string; error: string }[]
}

/** Uploads the photos in a backup. With `onlyMissing`, units that already have a photo are left alone. */
export async function restorePhotoBackup(backup: ReadBackup, onlyMissing: boolean, onProgress: Progress): Promise<RestoreResult> {
  const existing = new Set(photoRows().map((r) => r.unit_id))
  const todo = backup.entries.filter((e) => !(onlyMissing && existing.has(e.unitId)))
  const result: RestoreResult = { restored: 0, skipped: backup.entries.length - todo.length + backup.unknown.length, failed: [] }
  await eachLimited(
    todo,
    3,
    async (e) => {
      try {
        const photo = new Blob([e.photo.bytes as BlobPart], { type: mimeOf(e.photo.ext) })
        const thumb = new Blob([e.thumb.bytes as BlobPart], { type: mimeOf(e.thumb.ext) })
        await uploadPhotoFiles(e.unitId, photo, thumb)
        result.restored++
      } catch (err) {
        result.failed.push({ name: e.name, error: err instanceof Error ? err.message : String(err) })
      }
    },
    onProgress,
  )
  return result
}
