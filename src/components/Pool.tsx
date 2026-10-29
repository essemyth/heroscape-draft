import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { unitIndex } from '../lib/data'
import { useUnitPhotos } from '../lib/photos'
import { UnitPhotoView, UnitThumb } from './PhotoControls'
import { armyOf, checkUnit, costOf, remainingCount } from '../lib/draft'
import { linkedInArmy, synergiesFor } from '../lib/synergy'
import { generalStyle } from '../lib/generals'
import { GeneralBadge } from './GeneralBadge'
import type { DraftState, Unit } from '../lib/types'

type SortKey = 'name' | 'cost' | 'life' | 'move' | 'range' | 'attack' | 'defense'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  cost: 'Cost',
  life: 'Life',
  move: 'Move',
  range: 'Range',
  attack: 'Attack',
  defense: 'Defense',
}

interface Props {
  state: DraftState
  /** Player whose legality the pool shows; null when the draft is over. */
  playerId: string | null
  canPick: boolean
  onPick: (unitId: string) => void
  /** This device may add and replace unit photos. */
  canEditPhotos: boolean
  /** Just looking through a collection: no drafting, every unit shown as available. */
  browse?: boolean
}

export function Pool({ state, playerId, canPick, onPick, canEditPhotos, browse = false }: Props) {
  const photoOf = useUnitPhotos()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [rarity, setRarity] = useState('')
  const [general, setGeneral] = useState('')
  const [showUndraftable, setShowUndraftable] = useState(false)
  const [synergyOnly, setSynergyOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('name')
  // Names read best A→Z; cost and stats are most useful high→low first.
  const [descending, setDescending] = useState(false)
  const chooseSort = (key: SortKey) => {
    setSort(key)
    setDescending(key !== 'name')
  }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  /** Opens another unit from a synergy link: clears any filter hiding it, expands it and scrolls to it. */
  const jumpTo = (id: string) => {
    const unit = unitIndex.get(id)
    if (!unit) return
    if (q && !matches(unit, q)) setSearch('')
    if (type && unit.type !== type) setType('')
    if (rarity === 'Unique' ? unit.rarity !== 'Unique' : rarity === 'Common' && unit.rarity === 'Unique') setRarity('')
    if (general && unit.general !== general) setGeneral('')
    if (synergyOnly && linkedInArmy(unit, myArmy).length === 0) setSynergyOnly(false)
    if (!(playerId && checkUnit(state, playerId, unit, unitIndex).ok)) setShowUndraftable(true)
    setExpanded(id)
    setFlash(id)
  }

  // Scroll once the row has rendered with its new filters, then fade the highlight.
  useEffect(() => {
    if (!flash) return
    document.getElementById(`unit-${flash}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  const format = state.settings.format
  const poolUnits = useMemo(() => Object.keys(state.pool).map((id) => unitIndex.get(id)!), [state.pool])
  const generals = useMemo(() => [...new Set(poolUnits.map((u) => u.general))].sort(), [poolUnits])
  const myArmy = playerId ? [...new Map(armyOf(state, playerId, unitIndex).map((u) => [u.id, u])).values()] : []

  const q = search.trim().toLowerCase()
  const rows = poolUnits
    .map((unit) => ({
      unit,
      cost: costOf(unit, format) ?? 0,
      left: remainingCount(state, unit.id),
      check: browse
        ? ({ ok: true } as const)
        : playerId
          ? checkUnit(state, playerId, unit, unitIndex)
          : ({ ok: false, reason: '' } as const),
      linked: linkedInArmy(unit, myArmy),
    }))
    .filter(({ unit, check, linked }) => {
      if (!showUndraftable && !check.ok) return false
      if (synergyOnly && linked.length === 0) return false
      if (type && unit.type !== type) return false
      if (rarity === 'Unique' && unit.rarity !== 'Unique') return false
      if (rarity === 'Common' && unit.rarity === 'Unique') return false
      if (general && unit.general !== general) return false
      if (q && !matches(unit, q)) return false
      return true
    })
    .sort((a, b) => {
      const byName = a.unit.name.localeCompare(b.unit.name)
      if (sort === 'name') return descending ? -byName : byName
      const value = (r: typeof a) => (sort === 'cost' ? r.cost : r.unit[sort])
      const diff = value(a) - value(b)
      // Ties stay alphabetical either way.
      return (descending ? -diff : diff) || byName
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
        <span className="sort-control">
          <select value={sort} onChange={(e) => chooseSort(e.target.value as SortKey)} aria-label="Sort by">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                Sort: {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setDescending((d) => !d)}
            title={sort === 'name' ? (descending ? 'Z to A' : 'A to Z') : descending ? 'Highest first' : 'Lowest first'}
            aria-label={`Sort direction: ${descending ? 'descending' : 'ascending'}`}
          >
            {descending ? '↓' : '↑'}
          </button>
        </span>
        {!browse && (
          <label className="check" title="Include units you can't afford, already have, or that are all drafted">
            <input type="checkbox" checked={showUndraftable} onChange={(e) => setShowUndraftable(e.target.checked)} />
            Show undraftable
          </label>
        )}
        {myArmy.length > 0 && (
          <label className="check" title="Only units whose powers work with units in your army, or the other way round">
            <input type="checkbox" checked={synergyOnly} onChange={(e) => setSynergyOnly(e.target.checked)} />
            Synergy with my army
          </label>
        )}
      </div>

      <div className="pool-count muted">{rows.length} shown</div>

      <ul className="unit-list">
        {rows.map(({ unit, left, check, linked }) => {
          const open = expanded === unit.id
          // The faded row background uses the small thumbnail; the full photo only loads when expanded.
          const image = photoOf(unit.id)?.thumbUrl
          return (
            <li
              key={unit.id}
              id={`unit-${unit.id}`}
              className={`unit-row ${check.ok ? '' : 'blocked'} ${left <= 0 ? 'gone' : ''} ${image ? 'has-image' : ''} ${flash === unit.id ? 'flash' : ''}`}
              style={
                {
                  '--general': generalStyle(unit.general).rowColor,
                  '--row-tint': `${generalStyle(unit.general).rowTint}%`,
                  '--row-stripe': generalStyle(unit.general).stripe,
                  ...(image ? { '--unit-image': `url("${image}")` } : {}),
                } as CSSProperties
              }
            >
              <button type="button" className="unit-summary" onClick={() => setExpanded(open ? null : unit.id)} aria-expanded={open}>
                <span className="unit-cost">{costOf(unit, format) ?? '—'}</span>
                <GeneralBadge general={unit.general} />
                <span className="unit-main">
                  <span className="unit-name">{unit.name}</span>
                  <span className="unit-meta">
                    {unit.rarity} {unit.type} · {unit.general} · {unit.figures} fig
                    {linked.length > 0 && (
                      <span className="synergy-chip" title={`Synergy with ${linked.map((u) => u.name).join(', ')}`}>
                        ⚡ {linked.length}
                      </span>
                    )}
                  </span>
                </span>
                <UnitThumb unit={unit} />
                <span className="unit-stats" aria-label="Life, move, range, attack, defense">
                  <Stat kind="life" label="Lif" value={unit.life} active={sort === 'life'} />
                  <Stat kind="move" label="Mov" value={unit.move} active={sort === 'move'} />
                  <Stat kind="range" label="Ran" value={unit.range} active={sort === 'range'} />
                  <Stat kind="attack" label="Atk" value={unit.attack} active={sort === 'attack'} />
                  <Stat kind="defense" label="Def" value={unit.defense} active={sort === 'defense'} />
                </span>
                {browse ? (
                  <span className="unit-left" title="Copies owned">
                    {state.pool[unit.id] > 1 ? `×${state.pool[unit.id]}` : ''}
                  </span>
                ) : (
                  <span className="unit-left" title="Copies left in the pool">
                    {left}/{state.pool[unit.id]}
                  </span>
                )}
              </button>
              {!browse && (
                <button
                  type="button"
                  className="primary draft-btn"
                  disabled={!canPick || !check.ok}
                  title={check.ok ? undefined : check.reason}
                  onClick={() => onPick(unit.id)}
                >
                  Draft
                </button>
              )}
              {!check.ok && check.reason && left > 0 && <span className="unit-reason">{check.reason}</span>}
              {open && <UnitDetails unit={unit} state={state} playerId={playerId} onJump={jumpTo} canEditPhotos={canEditPhotos} browse={browse} />}
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

function Stat({ kind, label, value, active }: { kind: string; label: string; value: number; active: boolean }) {
  return (
    <span className={`stat stat-${kind} ${active ? 'sorted' : ''}`}>
      <span className="stat-label">{label}</span>
      {value}
    </span>
  )
}

interface DetailsProps {
  unit: Unit
  state: DraftState
  playerId: string | null
  onJump: (unitId: string) => void
  canEditPhotos?: boolean
  browse?: boolean
}

export function UnitDetails({ unit, state, playerId, onJump, canEditPhotos = false, browse = false }: DetailsProps) {
  return (
    <div className="unit-details">
      <UnitPhotoView unit={unit} canEdit={canEditPhotos} />
      {/* On phones the row only has room for the essentials, so the rest shows here. */}
      <div className="details-compact">
        <span className="unit-stats">
          <Stat kind="life" label="Lif" value={unit.life} active={false} />
          <Stat kind="move" label="Mov" value={unit.move} active={false} />
          <Stat kind="range" label="Ran" value={unit.range} active={false} />
          <Stat kind="attack" label="Atk" value={unit.attack} active={false} />
          <Stat kind="defense" label="Def" value={unit.defense} active={false} />
        </span>
        <span className="muted">
          {unit.rarity} {unit.type} · {unit.general} · {unit.figures} fig · {browse ? `${state.pool[unit.id]} owned` : `${remainingCount(state, unit.id)} of ${state.pool[unit.id]} left`}
        </span>
      </div>
      <p className="muted">
        {unit.species} {unit.unitClass} · {unit.personality} · {unit.size} {unit.height} · {unit.homeworld} · {unit.set}
      </p>
      {unit.powers.map((p) => (
        <p key={p.name}>
          <strong>{p.name}</strong> {p.text}
        </p>
      ))}
      <Synergies unit={unit} state={state} playerId={playerId} onJump={onJump} browse={browse} />
      {unit.heroscapersUrl && (
        <a href={unit.heroscapersUrl} target="_blank" rel="noreferrer">
          Heroscapers book →
        </a>
      )}
    </div>
  )
}

const MAX_CHIPS = 10

/** What this unit's powers help, and whose powers help it, among units in this draft's pool. */
function Synergies({ unit, state, playerId, onJump, browse = false }: DetailsProps) {
  const pool = Object.keys(state.pool).map((id) => unitIndex.get(id)!)
  const { boosts, boostedBy } = synergiesFor(unit, pool)
  const mine = new Set(playerId ? armyOf(state, playerId, unitIndex).map((u) => u.id) : [])
  const names = new Map(state.settings.players.map((p) => [p.id, p.name]))
  const takenBy = (id: string) =>
    [...new Set(state.picks.filter((p) => p.kind === 'pick' && p.unitId === id).map((p) => names.get(p.playerId)))].join(', ')

  // Yours first, then still available, then taken.
  const rank = (u: Unit) => (mine.has(u.id) ? 0 : remainingCount(state, u.id) > 0 ? 1 : 2)
  const chips = (units: Unit[]) => {
    const sorted = [...units].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    return (
      <>
        {sorted.slice(0, MAX_CHIPS).map((u) => {
          const status = ['mine', 'open', 'taken'][rank(u)]
          const title = status === 'mine' ? 'In your army' : status === 'taken' ? `Taken by ${takenBy(u.id)}` : 'Still in the pool'
          return (
            <button key={u.id} type="button" className={`syn-unit ${status}`} title={`${title}. Click to view.`} onClick={() => onJump(u.id)}>
              <GeneralBadge general={u.general} size={16} />
              {u.name}
              {status === 'mine' && <span className="syn-tag">yours</span>}
            </button>
          )
        })}
        {sorted.length > MAX_CHIPS && <span className="muted">+{sorted.length - MAX_CHIPS} more</span>}
      </>
    )
  }

  return (
    <div className="synergies">
      <h4>{browse ? 'Synergies in this collection' : 'Synergies in this pool'}</h4>
      {boosts.length === 0 && boostedBy.length === 0 && <p className="muted">None found.</p>}
      {boosts.map((b) => (
        <div key={b.power + b.label} className="syn-line">
          <span className="syn-label">
            <strong>{b.power}</strong> helps {b.label}:
          </span>
          {chips(b.units)}
        </div>
      ))}
      {boostedBy.length > 0 && (
        <div className="syn-line">
          <span className="syn-label">Helped by:</span>
          {chips(boostedBy.map((b) => b.unit))}
        </div>
      )}
      <p className="muted syn-note">Found from power text, so a few may be missed or misread.</p>
    </div>
  )
}
