import { useMemo, useState } from 'react'
import { unitIndex } from '../lib/data'
import { checkUnit, costOf, remainingCount } from '../lib/draft'
import type { DraftState, Unit } from '../lib/types'

type SortKey = 'name' | 'costDesc' | 'costAsc'

interface Props {
  state: DraftState
  /** Player whose legality the pool shows; null when the draft is over. */
  playerId: string | null
  canPick: boolean
  onPick: (unitId: string) => void
}

export function Pool({ state, playerId, canPick, onPick }: Props) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [rarity, setRarity] = useState('')
  const [general, setGeneral] = useState('')
  const [draftableOnly, setDraftableOnly] = useState(false)
  const [hideGone, setHideGone] = useState(true)
  const [sort, setSort] = useState<SortKey>('name')
  const [expanded, setExpanded] = useState<string | null>(null)

  const format = state.settings.format
  const poolUnits = useMemo(() => Object.keys(state.pool).map((id) => unitIndex.get(id)!), [state.pool])
  const generals = useMemo(() => [...new Set(poolUnits.map((u) => u.general))].sort(), [poolUnits])

  const q = search.trim().toLowerCase()
  const rows = poolUnits
    .map((unit) => ({
      unit,
      cost: costOf(unit, format) ?? 0,
      left: remainingCount(state, unit.id),
      check: playerId ? checkUnit(state, playerId, unit, unitIndex) : ({ ok: false, reason: '' } as const),
    }))
    .filter(({ unit, left, check }) => {
      if (hideGone && left <= 0) return false
      if (draftableOnly && !check.ok) return false
      if (type && unit.type !== type) return false
      if (rarity === 'Unique' && unit.rarity !== 'Unique') return false
      if (rarity === 'Common' && unit.rarity === 'Unique') return false
      if (general && unit.general !== general) return false
      if (q && !matches(unit, q)) return false
      return true
    })
    .sort((a, b) => {
      if (sort === 'costDesc') return b.cost - a.cost || a.unit.name.localeCompare(b.unit.name)
      if (sort === 'costAsc') return a.cost - b.cost || a.unit.name.localeCompare(b.unit.name)
      return a.unit.name.localeCompare(b.unit.name)
    })

  return (
    <section className="panel pool">
      <div className="pool-filters">
        <input
          type="search"
          placeholder="Search units, powers, classes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Heroes & squads</option>
          <option value="Hero">Heroes</option>
          <option value="Squad">Squads</option>
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
          <option value="">Any rarity</option>
          <option value="Unique">Unique</option>
          <option value="Common">Common / Uncommon</option>
        </select>
        <select value={general} onChange={(e) => setGeneral(e.target.value)} aria-label="General">
          <option value="">All generals</option>
          {generals.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="name">Sort: name</option>
          <option value="costDesc">Sort: cost high → low</option>
          <option value="costAsc">Sort: cost low → high</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={draftableOnly} onChange={(e) => setDraftableOnly(e.target.checked)} />
          Draftable only
        </label>
        <label className="check">
          <input type="checkbox" checked={hideGone} onChange={(e) => setHideGone(e.target.checked)} />
          Hide drafted
        </label>
      </div>

      <div className="pool-count muted">{rows.length} shown</div>

      <ul className="unit-list">
        {rows.map(({ unit, cost, left, check }) => {
          const open = expanded === unit.id
          return (
            <li key={unit.id} className={`unit-row ${check.ok ? '' : 'blocked'} ${left <= 0 ? 'gone' : ''}`}>
              <button type="button" className="unit-summary" onClick={() => setExpanded(open ? null : unit.id)} aria-expanded={open}>
                <span className="unit-cost">{cost}</span>
                <span className="unit-main">
                  <span className="unit-name">{unit.name}</span>
                  <span className="unit-meta">
                    {unit.rarity} {unit.type} · {unit.general} · {unit.figures} fig
                  </span>
                </span>
                <span className="unit-stats" aria-label="Life, move, range, attack, defense">
                  <Stat label="L" value={unit.life} />
                  <Stat label="M" value={unit.move} />
                  <Stat label="R" value={unit.range} />
                  <Stat label="A" value={unit.attack} />
                  <Stat label="D" value={unit.defense} />
                </span>
                <span className="unit-left" title="Copies left in the pool">
                  {left}/{state.pool[unit.id]}
                </span>
              </button>
              <button
                type="button"
                className="primary draft-btn"
                disabled={!canPick || !check.ok}
                title={check.ok ? undefined : check.reason}
                onClick={() => onPick(unit.id)}
              >
                Draft
              </button>
              {!check.ok && check.reason && left > 0 && <span className="unit-reason">{check.reason}</span>}
              {open && <UnitDetails unit={unit} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function matches(unit: Unit, q: string): boolean {
  return (
    unit.name.toLowerCase().includes(q) ||
    unit.unitClass.toLowerCase().includes(q) ||
    unit.species.toLowerCase().includes(q) ||
    unit.personality.toLowerCase().includes(q) ||
    unit.powers.some((p) => p.name.toLowerCase().includes(q))
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="stat">
      <span className="stat-label">{label}</span>
      {value}
    </span>
  )
}

export function UnitDetails({ unit }: { unit: Unit }) {
  return (
    <div className="unit-details">
      <p className="muted">
        {unit.species} {unit.unitClass} · {unit.personality} · {unit.size} {unit.height} · {unit.homeworld} · {unit.set}
      </p>
      {unit.powers.map((p) => (
        <p key={p.name}>
          <strong>{p.name}</strong> {p.text}
        </p>
      ))}
      {unit.heroscapersUrl && (
        <a href={unit.heroscapersUrl} target="_blank" rel="noreferrer">
          Heroscapers book →
        </a>
      )}
    </div>
  )
}
