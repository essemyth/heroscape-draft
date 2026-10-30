// Unit photos taken in the app, stored in Supabase. Falls back to photos bundled in
// src/assets/units for units that don't have an uploaded one.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { unitImages } from './data'
import { supabase } from './supabase'

const BUCKET = 'unit-photos'

export interface UnitPhoto {
  url: string
  thumbUrl: string
}

export interface PhotoRow {
  unit_id: string
  path: string
  thumb_path: string
}

const publicUrl = (path: string) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

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
  const { data } = await supabase.from('unit_photos').select('unit_id, path, thumb_path')
  if (data) setRows(data as PhotoRow[])
}

function start() {
  if (started) return
  started = true
  load()
  supabase
    .channel('unit-photos')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'unit_photos' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = (payload.old as Partial<PhotoRow>).unit_id
        if (id) delete rowsByUnit[id]
      } else {
        const row = payload.new as PhotoRow
        rowsByUnit[row.unit_id] = row
      }
      emit()
    })
    .subscribe((status) => status === 'SUBSCRIBED' && load())
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
    supabase
      .from('photo_editors')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setIsEditor(Boolean(data)))
  }, [userId, version])
  return [isEditor, () => setVersion((v) => v + 1)]
}

/** Unlocks photo editing on this device. Resolves false for a wrong code. */
export async function claimPhotoEditor(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_photo_editor', { code })
  if (error) throw error
  return data === true
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

const uploadError = (message: string) =>
  new Error(message.includes('row-level security') ? 'This device is not allowed to change photos' : message)

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
  // A new file name each time, so nobody sees a cached old photo after a replace.
  const stamp = Date.now()
  const ext = (b: Blob) => (b.type === 'image/webp' ? 'webp' : 'jpg')
  const path = `${unitId}/${stamp}.${ext(photo)}`
  const thumbPath = `${unitId}/${stamp}-thumb.${ext(thumb)}`
  const storage = supabase.storage.from(BUCKET)
  for (const [p, blob] of [
    [path, photo],
    [thumbPath, thumb],
  ] as const) {
    const { error } = await storage.upload(p, blob, { contentType: blob.type, cacheControl: '31536000' })
    if (error) throw uploadError(error.message)
  }

  const previous = rowsByUnit[unitId]
  const { error } = await supabase
    .from('unit_photos')
    .upsert({ unit_id: unitId, path, thumb_path: thumbPath, updated_at: new Date().toISOString() })
  if (error) throw error

  // Show it right away without waiting for the realtime echo.
  rowsByUnit[unitId] = { unit_id: unitId, path, thumb_path: thumbPath }
  emit()

  // Tidy up the replaced files; harmless if it fails.
  if (previous) await storage.remove([previous.path, previous.thumb_path])
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
  img.crossOrigin = 'anonymous' // storage allows it; needed to read the pixels back out
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

  const thumbPath = `${unitId}/${Date.now()}-thumb.${thumb.type === 'image/webp' ? 'webp' : 'jpg'}`
  const storage = supabase.storage.from(BUCKET)
  const { error: upError } = await storage.upload(thumbPath, thumb, { contentType: thumb.type, cacheControl: '31536000' })
  if (upError) throw uploadError(upError.message)
  const { error } = await supabase
    .from('unit_photos')
    .update({ thumb_path: thumbPath, updated_at: new Date().toISOString() })
    .eq('unit_id', unitId)
  if (error) throw error

  rowsByUnit[unitId] = { ...row, thumb_path: thumbPath }
  emit()
  await storage.remove([row.thumb_path])
}

/** Whether the unit has a photo uploaded in the app (bundled photos can't be re-cropped). */
export function isUploaded(unitId: string): boolean {
  return unitId in rowsByUnit
}
