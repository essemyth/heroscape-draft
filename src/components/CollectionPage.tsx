import { useMemo, useState } from 'react'
import { collections, unitIndex } from '../lib/data'
import { costOf } from '../lib/draft'
import { usePhotoEditor } from '../lib/photos'
import type { DraftState, Format } from '../lib/types'
import { Pool } from './Pool'

const PRICING: { format: Format; label: string }[] = [
  { format: 'normal', label: 'Normal' },
  { format: 'deltaClassic', label: 'Delta' },
]

interface Props {
  me: string
  navigate: (path: string) => void
}

/** Browse a collection with the draft pool's rows, filters and details, minus the drafting. */
export function CollectionPage({ me, navigate }: Props) {
  const ids = Object.keys(collections)
  const [collectionId, setCollectionId] = useState(ids[0] ?? '')
  const [format, setFormat] = useState<Format>('normal')
  const [canEditPhotos] = usePhotoEditor(me)

  // The pool component works on a draft state, so describe the collection as one that never started.
  const state = useMemo<DraftState>(() => {
    const pool = Object.fromEntries(Object.entries(collections[collectionId] ?? {}).filter(([id]) => unitIndex.has(id)))
    return {
      settings: { format, pointsTotal: 0, groups: [], timerSeconds: null, players: [], collectionId },
      pool,
      picks: [],
      donePlayers: [],
      slot: 0,
      status: 'complete',
      turnStartedAt: 0,
    }
  }, [collectionId, format])

  const units = Object.keys(state.pool).length
  const cards = Object.values(state.pool).reduce((a, b) => a + b, 0)
  const points = Object.entries(state.pool).reduce((sum, [id, qty]) => sum + (costOf(unitIndex.get(id)!, format) ?? 0) * qty, 0)

  return (
    <div className="board">
      <header className="panel collection-header">
        <button type="button" className="link-btn back" onClick={() => navigate('/')}>
          ← Home
        </button>
        <h1>{collectionId}'s collection</h1>
        <p className="muted">
          <strong>{units}</strong> units · <strong>{cards}</strong> cards · <strong>{points.toLocaleString()}</strong> points
        </p>
        <div className="collection-controls">
          {ids.length > 1 && (
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="Collection">
              {ids.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          )}
          <div className="chip-row" role="group" aria-label="Point costs">
            {PRICING.map((p) => (
              <button key={p.format} type="button" className={`chip ${format === p.format ? 'on' : ''}`} onClick={() => setFormat(p.format)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <Pool state={state} playerId={null} canPick={false} onPick={() => {}} canEditPhotos={canEditPhotos} browse />
    </div>
  )
}
