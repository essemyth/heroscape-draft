import { useMemo, useState } from 'react'
import { ALL_GROUPS, DEFAULT_GROUPS, collections, unitIndex } from '../lib/data'
import { buildPool, costOf } from '../lib/draft'
import { FORMAT_LABELS, type DraftSettings, type Format, type Player } from '../lib/types'

const POINT_PRESETS = [300, 400, 500, 550, 600]
const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No timer', value: null },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '90 seconds', value: 90 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
]

let nextPlayerId = 1
const newPlayer = (name: string): Player => ({ id: `p${Date.now()}-${nextPlayerId++}`, name })

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

interface Props {
  initial?: DraftSettings
  onStart: (settings: DraftSettings, pool: Record<string, number>) => void
}

export function Lobby({ initial, onStart }: Props) {
  const collectionIds = Object.keys(collections)
  const [collectionId, setCollectionId] = useState(initial?.collectionId ?? collectionIds[0] ?? '')
  const [format, setFormat] = useState<Format>(initial?.format ?? 'normal')
  const [pointsTotal, setPointsTotal] = useState(initial?.pointsTotal ?? 500)
  const [groups, setGroups] = useState<string[]>(initial?.groups ?? DEFAULT_GROUPS)
  const [timerSeconds, setTimerSeconds] = useState<number | null>(initial?.timerSeconds ?? null)
  const [players, setPlayers] = useState<Player[]>(initial?.players ?? [newPlayer('Player 1'), newPlayer('Player 2')])

  const settings: DraftSettings = { format, pointsTotal, groups, timerSeconds, players, collectionId }
  const collection = collections[collectionId] ?? {}

  // Cards owned per group, so the toggles show what each one adds.
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [id, qty] of Object.entries(collections[collectionId] ?? {})) {
      const g = unitIndex.get(id)?.group
      if (g) counts[g] = (counts[g] ?? 0) + qty
    }
    return counts
  }, [collectionId])

  const pool = buildPool(collection, unitIndex, settings)
  const poolCards = Object.values(pool).reduce((a, b) => a + b, 0)
  const poolPoints = Object.entries(pool).reduce((sum, [id, qty]) => sum + (costOf(unitIndex.get(id)!, format) ?? 0) * qty, 0)

  const namesOk = players.every((p) => p.name.trim()) && new Set(players.map((p) => p.name.trim())).size === players.length
  const canStart = players.length >= 2 && namesOk && pointsTotal > 0 && poolCards > 0

  const toggleGroup = (g: string) => setGroups((gs) => (gs.includes(g) ? gs.filter((x) => x !== g) : [...gs, g]))
  const renamePlayer = (id: string, name: string) => setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)))
  const movePlayer = (index: number, delta: number) =>
    setPlayers((ps) => {
      const copy = [...ps]
      const [p] = copy.splice(index, 1)
      copy.splice(index + delta, 0, p)
      return copy
    })

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>HeroScape Draft</h1>
        <p className="muted">Set up the draft. Settings lock once it starts.</p>
      </header>

      <section className="panel">
        <h2>Format</h2>
        <div className="field-row">
          <label className="field">
            <span>Pricing</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pick timer</span>
            <select
              value={timerSeconds ?? ''}
              onChange={(e) => setTimerSeconds(e.target.value === '' ? null : Number(e.target.value))}
            >
              {TIMER_OPTIONS.map((o) => (
                <option key={o.label} value={o.value ?? ''}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Army points</span>
          <div className="chip-row">
            {POINT_PRESETS.map((p) => (
              <button key={p} type="button" className={`chip ${pointsTotal === p ? 'on' : ''}`} onClick={() => setPointsTotal(p)}>
                {p}
              </button>
            ))}
            <input
              className="points-input"
              type="number"
              min={10}
              step={10}
              value={pointsTotal}
              onChange={(e) => setPointsTotal(Math.max(0, Number(e.target.value)))}
              aria-label="Custom points total"
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Pool</h2>
        {collectionIds.length > 1 && (
          <label className="field">
            <span>Collection</span>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              {collectionIds.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
        )}
        <div className="field">
          <span>Unit groups</span>
          <div className="chip-row">
            {ALL_GROUPS.map((g) => (
              <button key={g} type="button" className={`chip ${groups.includes(g) ? 'on' : ''}`} onClick={() => toggleGroup(g)}>
                {g}
                <span className="chip-count">{groupCounts[g] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          {collectionId}'s pool: <strong>{Object.keys(pool).length}</strong> units, <strong>{poolCards}</strong> cards,{' '}
          <strong>{poolPoints.toLocaleString()}</strong> points
        </p>
      </section>

      <section className="panel">
        <h2>Players</h2>
        <p className="muted">Snake order: first pick goes top to bottom, then back up.</p>
        <ol className="player-list">
          {players.map((p, i) => (
            <li key={p.id}>
              <span className="seat">{i + 1}</span>
              <input value={p.name} onChange={(e) => renamePlayer(p.id, e.target.value)} aria-label={`Player ${i + 1} name`} />
              <button type="button" className="icon-btn" disabled={i === 0} onClick={() => movePlayer(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={i === players.length - 1}
                onClick={() => movePlayer(i, 1)}
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={players.length <= 2}
                onClick={() => setPlayers((ps) => ps.filter((x) => x.id !== p.id))}
                aria-label="Remove player"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
        <div className="button-row">
          <button
            type="button"
            disabled={players.length >= 8}
            onClick={() => setPlayers((ps) => [...ps, newPlayer(`Player ${ps.length + 1}`)])}
          >
            Add player
          </button>
          <button type="button" onClick={() => setPlayers((ps) => shuffle(ps))}>
            Randomize order
          </button>
        </div>
        {!namesOk && <p className="warn">Every player needs a different name.</p>}
      </section>

      <button type="button" className="primary start-btn" disabled={!canStart} onClick={() => onStart(settings, pool)}>
        Start draft
      </button>
    </div>
  )
}
