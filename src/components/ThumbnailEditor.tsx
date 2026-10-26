import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { saveThumbnailCrop, type ThumbCrop } from '../lib/photos'
import type { Unit } from '../lib/types'

const MAX_ZOOM = 4

/** Keeps the crop inside the photo: the visible window is 1/zoom of the photo each way. */
function clamp(c: ThumbCrop): ThumbCrop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom))
  const half = 1 / (2 * zoom)
  const fit = (v: number) => Math.min(1 - half, Math.max(half, v))
  return { zoom, cx: fit(c.cx), cy: fit(c.cy) }
}

interface Props {
  unit: Unit
  photoUrl: string
  onClose: () => void
}

/**
 * Pick the part of the full photo the thumbnail shows. The frame has the thumbnail's shape;
 * drag to move, pinch / scroll / slider to zoom.
 */
export function ThumbnailEditor({ unit, photoUrl, onClose }: Props) {
  const [crop, setCrop] = useState<ThumbCrop>({ cx: 0.5, cy: 0.5, zoom: 1 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  // Escape closes; lock page scroll while open so dragging doesn't scroll the page behind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setCrop((c) => clamp({ ...c, zoom: c.zoom * Math.exp(-e.deltaY * 0.0015) }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current
    const prev = map.get(e.pointerId)
    if (!prev || !frame.current) return
    const width = frame.current.clientWidth
    const height = frame.current.clientHeight
    const next = { x: e.clientX, y: e.clientY }

    if (map.size >= 2) {
      // Pinch: zoom by the change in distance between the two fingers.
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(next.x - other.x, next.y - other.y)
      if (before > 0) setCrop((c) => clamp({ ...c, zoom: (c.zoom * after) / before }))
    } else {
      // Drag: the photo follows the finger, so the window moves the other way.
      const dx = next.x - prev.x
      const dy = next.y - prev.y
      setCrop((c) => clamp({ ...c, cx: c.cx - dx / (width * c.zoom), cy: c.cy - dy / (height * c.zoom) }))
    }
    map.set(e.pointerId, next)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveThumbnailCrop(unit.id, crop)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the thumbnail')
      setSaving(false)
    }
  }

  // Place the photo so the crop window fills the frame.
  const imgStyle = {
    width: `${crop.zoom * 100}%`,
    height: `${crop.zoom * 100}%`,
    left: `${(0.5 - crop.cx * crop.zoom) * 100}%`,
    top: `${(0.5 - crop.cy * crop.zoom) * 100}%`,
  }

  // Rendered on <body> so no row or sticky banner can sit on top of it.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label={`Thumbnail for ${unit.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Thumbnail: {unit.name}</h2>
        <p className="muted">Drag to move, pinch or scroll to zoom. The frame shows exactly what the thumbnail will be.</p>
        <div
          ref={frame}
          className="crop-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img src={`${photoUrl}?crop=1`} alt="" crossOrigin="anonymous" draggable={false} style={imgStyle} />
        </div>
        <label className="zoom-row">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => clamp({ ...c, zoom: Number(e.target.value) }))}
          />
        </label>
        {error && <p className="warn">{error}</p>}
        <div className="button-row">
          <button type="button" className="primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save thumbnail'}
          </button>
          <button type="button" disabled={saving} onClick={() => setCrop({ cx: 0.5, cy: 0.5, zoom: 1 })}>
            Reset
          </button>
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
