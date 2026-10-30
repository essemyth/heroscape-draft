// Unit photos taken in the app, stored by our server (server/app.ts). Falls back to photos
// bundled in src/assets/units for units that don't have an uploaded one.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { unitImages } from './data'
import { api, listen } from './api'

export interface UnitPhoto {
  url: string
  thumbUrl: string
}

export interface PhotoRow {
  unit_id: string
  path: string
  thumb_path: string
}

const publicUrl = (path: string) => `/photos/${path}`

// --- Shared store: one fetch + one realtime subscription for the whole app -------------------

let uploaded: Record<string, UnitPhoto> = {}
let rowsByUnit: Record<string, PhotoRow> = {}
const listeners = new Set<() => void>()
let started = false

function setRows(rows: PhotoRow[]) {
  rowsByUnit = Object.fromEntries(rows.map((r) => [r.unit_id, r]))
  emit()
}

function emit() {
  uploaded = Object.fromEntries(
    Object.values(rowsByUnit).map((r) => [r.unit_id, { url: publicUrl(r.path), thumbUrl: publicUrl(r.thumb_path) }]),
  )
  for (const l of listeners) l()
}

async function load() {
  try {
    setRows(await api<PhotoRow[]>('GET', '/api/photos'))
  } catch {
    // Offline for a moment; the live stream reloads when it reconnects.
  }
}

function start() {
  if (started) return
  started = true
  load()
  listen(
    '/api/photos/events',
    {
      photo: (data) => {
        const row = data as PhotoRow
        rowsByUnit[row.unit_id] = row
        emit()
      },
    },
    // Catch up on anything missed while (re)connecting.
    () => load(),
  )
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Photo for every unit that has one: uploaded first, then bundled. */
export function useUnitPhotos(): (unitId: string) => UnitPhoto | null {
  const current = useSyncExternalStore(subscribe, () => uploaded)
  return (unitId) => current[unitId] ?? (unitImages[unitId] ? { url: unitImages[unitId], thumbUrl: unitImages[unitId] } : null)
}

// --- Who may add photos ------------------------------------------------------------------------

export function usePhotoEditor(userId: string | null): [boolean, () => void] {
  const [isEditor, setIsEditor] = useState(false)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!userId) return
    api<{ isEditor: boolean }>('GET', '/api/photo-editor')
      .then((r) => setIsEditor(r.isEditor))
      .catch(() => setIsEditor(false))
  }, [userId, version])
  return [isEditor, () => setVersion((v) => v + 1)]
}

/** Unlocks photo editing on this device. Resolves false for a wrong code. */
export async function claimPhotoEditor(code: string): Promise<boolean> {
  const { ok } = await api<{ ok: boolean }>('POST', '/api/photo-editor/claim', { code })
  return ok
}

// --- Uploading ---------------------------------------------------------------------------------

const PHOTO_SIZE = { width: 800, height: 500 }
// Twice the displayed size, so thumbnails stay sharp on high-density phone screens.
const THUMB_SIZE = { width: 320, height: 200 }

type Source = { image: CanvasImageSource; width: number; height: number }

/** Decodes a photo upright (browsers apply its EXIF rotation), falling back to an <img> where needed. */
async function decode(file: File): Promise<Source & { done: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { image: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() }
  } catch {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  }
}

/** Encodes a canvas as WebP where the browser supports it, else JPEG. */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  const toBlob = (type: string) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.82))
  const webp = await toBlob('image/webp')
  if (webp && webp.type === 'image/webp') return webp
  const jpeg = await toBlob('image/jpeg')
  if (!jpeg) throw new Error('Could not process the photo')
  return jpeg
}

/** Center-crops to 8:5 and scales down. */
async function render(bitmap: Source, size: { width: number; height: number }): Promise<Blob> {
  const target = size.width / size.height
  let sw = bitmap.width
  let sh = bitmap.height
  if (sw / sh > target) sw = sh * target
  else sh = sw / target
  const sx = (bitmap.width - sw) / 2
  const sy = (bitmap.height - sh) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const g = canvas.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap.image, sx, sy, sw, sh, 0, 0, size.width, size.height)
  return encode(canvas)
}

/** Shrinks a camera photo, uploads it and its thumbnail, and makes it the unit's photo. */
export async function uploadUnitPhoto(unitId: string, file: File): Promise<void> {
  const source = await decode(file)
  const [photo, thumb] = await Promise.all([render(source, PHOTO_SIZE), render(source, THUMB_SIZE)])
  source.done()
  await uploadPhotoFiles(unitId, photo, thumb)
}

/** Every uploaded photo, for backups. */
export function photoRows(): PhotoRow[] {
  return Object.values(rowsByUnit)
}

/** Waits until the uploaded-photo list has loaded (the store starts lazily). */
export async function loadPhotoRows(): Promise<PhotoRow[]> {
  start()
  await load()
  return photoRows()
}

export { publicUrl }

/** Uploads an already-sized photo and thumbnail and makes them the unit's photo, replacing any old one. */
export async function uploadPhotoFiles(unitId: string, photo: Blob, thumb: Blob): Promise<void> {
  // The server names the files (new names each time, so nobody sees a cached old photo)
  // and removes the replaced ones.
  const row = await api<PhotoRow>('POST', `/api/photos/${unitId}`, {
    photo: await toBase64(photo),
    photoType: photo.type,
    thumb: await toBase64(thumb),
    thumbType: thumb.type,
  })
  // Show it right away without waiting for the live update.
  rowsByUnit[unitId] = row
  emit()
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Part of the full photo to use as the thumbnail: center (0–1 across and down) and zoom (1 = whole photo). */
export interface ThumbCrop {
  cx: number
  cy: number
  zoom: number
}

/** Re-cuts a unit's thumbnail from its full photo, keeping the full photo as it is. */
export async function saveThumbnailCrop(unitId: string, crop: ThumbCrop): Promise<void> {
  const row = rowsByUnit[unitId]
  if (!row) throw new Error('Add a photo first')

  const img = new Image()
  img.crossOrigin = 'anonymous'
  // Its own URL so Safari doesn't reuse a copy cached without CORS, which would block reading pixels.
  img.src = `${publicUrl(row.path)}?crop=1`
  await img.decode()

  const sw = img.naturalWidth / crop.zoom
  const sh = img.naturalHeight / crop.zoom
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_SIZE.width
  canvas.height = THUMB_SIZE.height
  const g = canvas.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(img, crop.cx * img.naturalWidth - sw / 2, crop.cy * img.naturalHeight - sh / 2, sw, sh, 0, 0, canvas.width, canvas.height)
  const thumb = await encode(canvas)

  const updated = await api<PhotoRow>('PUT', `/api/photos/${unitId}/thumb`, { thumb: await toBase64(thumb), thumbType: thumb.type })
  rowsByUnit[unitId] = updated
  emit()
}

/** Whether the unit has a photo uploaded in the app (bundled photos can't be re-cropped). */
export function isUploaded(unitId: string): boolean {
  return unitId in rowsByUnit
}
