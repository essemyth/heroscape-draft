import { useMemo, useState } from 'react'
import { collections, NEW_FOR_DAYS, newUnitsIn, unitIndex } from '../lib/data'
import { costOf } from '../lib/draft'
import { usePhotoEditor } from '../lib/photos'
import type { DraftState, Format } from '../lib/types'
import { Pool } from './Pool'

const PRICING: { format: Format; label: string }[] = [
  { format: 'normal', label: 'Normal' },
  { format: 'deltaClassic', label: 'Delta' },
]

export type CollectionTab = 'all' | 'new'

interface Props {
  me: string
  navigate: (path: string) => void
  tab: CollectionTab
}

/** Browse a collection with the draft pool's rows, filters and details, minus the drafting. */
export function CollectionPage({ me, navigate, tab }: Props) {
  const ids = Object.keys(collections)
  const [collectionId, setCollectionId] = useState(ids[0] ?? '')
  const [format, setFormat] = useState<Format>('normal')
  const [canEditPhotos] = usePhotoEditor(me)
  const newUnits = useMemo(() => newUnitsIn(collectionId), [collectionId])

  // The pool component works on a draft state, so describe the collection as one that never started.
  // It always gets the whole collection, so synergies of new figures reach everything you own;
  // the New tab just shows fewer rows.
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

  const showOnly = useMemo(() => (tab === 'new' ? new Set(newUnits.keys()) : undefined), [tab, newUnits])
  const shown = Object.entries(state.pool).filter(([id]) => !showOnly || showOnly.has(id))
  const units = shown.length
  const cards = shown.reduce((a, [, qty]) => a + qty, 0)
  const points = shown.reduce((sum, [id, qty]) => sum + (costOf(unitIndex.get(id)!, format) ?? 0) * qty, 0)
  // Arriving from a synergy link on the New tab: open that unit (e.g. /collection#grimnak).
  const focusUnit = tab === 'all' ? window.location.hash.slice(1) || undefined : undefined

  return (
    <div className="board">
      <header className="panel collection-header">
        <button type="button" className="link-btn back" onClick={() => navigate('/')}>
          ← Home
        </button>
        <h1>{tab === 'new' ? 'New figures' : `${collectionId}'s collection`}</h1>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'all'} className={`tab ${tab === 'all' ? 'on' : ''}`} onClick={() => navigate('/collection')}>
            All figures
          </button>
          <button type="button" role="tab" aria-selected={tab === 'new'} className={`tab ${tab === 'new' ? 'on' : ''}`} onClick={() => navigate('/new')}>
            ✨ New figures <span className="tab-count">{newUnits.size}</span>
          </button>
        </div>
        <p className="muted">
          {tab === 'new' && <>Added in the last {NEW_FOR_DAYS} days: </>}
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
      {tab === 'new' && units === 0 ? (
        <section className="panel">
          <p className="muted">No figures have been added in the last {NEW_FOR_DAYS} days.</p>
        </section>
      ) : (
        <Pool
          key={`${tab}:${focusUnit ?? ''}`}
          state={state}
          playerId={null}
          canPick={false}
          onPick={() => {}}
          canEditPhotos={canEditPhotos}
          browse
          showOnly={showOnly}
          alwaysExpanded={tab === 'new'}
          hideFilters={tab === 'new'}
          showNotes={tab === 'new'}
          onJumpOutside={(id) => navigate(`/collection#${id}`)}
          focusUnit={focusUnit}
        />
      )}
    </div>
  )
}
