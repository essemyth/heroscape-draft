// Pure draft rules. No React or browser APIs here so this can later run server-side
// to validate picks.

import type { DraftSettings, DraftState, Pick, PickKind, Player, Unit } from './types'

export type UnitIndex = Map<string, Unit>

export function costOf(unit: Unit, format: DraftSettings['format']): number | null {
  return unit.cost[format]
}

/** Name without version suffix, e.g. "Syvarris (2.0)" -> "syvarris". */
export function baseName(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
}

/** Snake order: round 0 forward, round 1 reversed, and so on. */
export function playerForSlot(players: Player[], slot: number): Player {
  const n = players.length
  const round = Math.floor(slot / n)
  const pos = slot % n
  return players[round % 2 === 0 ? pos : n - 1 - pos]
}

export function roundOfSlot(players: Player[], slot: number): number {
  return Math.floor(slot / players.length) + 1
}

/** Builds the pool from a collection, keeping only units in the chosen groups with a cost in the chosen format. */
export function buildPool(collection: Record<string, number>, units: UnitIndex, settings: DraftSettings): Record<string, number> {
  const pool: Record<string, number> = {}
  for (const [id, qty] of Object.entries(collection)) {
    const unit = units.get(id)
    if (!unit || qty <= 0) continue
    if (!settings.groups.includes(unit.group)) continue
    if (costOf(unit, settings.format) === null) continue
    pool[id] = qty
  }
  return pool
}

export function remainingCount(state: DraftState, unitId: string): number {
  const taken = state.picks.filter((p) => p.kind === 'pick' && p.unitId === unitId).length
  return (state.pool[unitId] ?? 0) - taken
}

export function armyOf(state: DraftState, playerId: string, units: UnitIndex): Unit[] {
  return state.picks
    .filter((p) => p.playerId === playerId && p.kind === 'pick' && p.unitId)
    .map((p) => units.get(p.unitId!)!)
}

export function pointsOf(army: Unit[], format: DraftSettings['format']): number {
  return army.reduce((sum, u) => sum + (costOf(u, format) ?? 0), 0)
}

export function figuresOf(army: Unit[]): number {
  return army.reduce((sum, u) => sum + u.figures, 0)
}

/** Plain-text army list for sharing. */
export function armyText(state: DraftState, player: Player, units: UnitIndex): string {
  const { format, pointsTotal } = state.settings
  const army = armyOf(state, player.id, units)
  const lines = army.map((u) => `${u.name} (${costOf(u, format)})`)
  return [`${player.name}: ${pointsOf(army, format)}/${pointsTotal} pts, ${figuresOf(army)} figures`, ...lines].join('\n')
}

export type PickCheck = { ok: true } | { ok: false; reason: string }

/** Whether a player could add this unit to their army, ignoring whose turn it is. */
export function checkUnit(state: DraftState, playerId: string, unit: Unit, units: UnitIndex): PickCheck {
  const { format, pointsTotal } = state.settings
  const cost = costOf(unit, format)
  if (cost === null) return { ok: false, reason: 'No cost in this format' }
  if (remainingCount(state, unit.id) <= 0) return { ok: false, reason: 'None left' }

  const army = armyOf(state, playerId, units)
  const left = pointsTotal - pointsOf(army, format)
  if (cost > left) return { ok: false, reason: `Costs ${cost}, you have ${left} left` }

  if (unit.rarity === 'Unique') {
    const name = baseName(unit.name)
    const clash = army.find((u) => u.rarity === 'Unique' && baseName(u.name) === name)
    if (clash) return { ok: false, reason: `Already have ${clash.name}` }
  }
  return { ok: true }
}

export function hasLegalPick(state: DraftState, playerId: string, units: UnitIndex): boolean {
  return Object.keys(state.pool).some((id) => checkUnit(state, playerId, units.get(id)!, units).ok)
}

export function currentPlayer(state: DraftState): Player | null {
  if (state.status !== 'drafting') return null
  return playerForSlot(state.settings.players, state.slot)
}

/**
 * Moves from `fromSlot` to the next slot whose player is still drafting.
 * Players with nothing affordable left are marked done along the way.
 */
function advance(state: DraftState, fromSlot: number, units: UnitIndex, now: number): DraftState {
  const players = state.settings.players
  const donePlayers = [...state.donePlayers]
  let next: DraftState = { ...state, donePlayers }

  // Each full pass over all players either finds an active one or marks someone done,
  // so this terminates within players.length * 2 iterations.
  for (let slot = fromSlot; ; slot++) {
    if (donePlayers.length >= players.length) {
      return { ...next, status: 'complete', slot }
    }
    const player = playerForSlot(players, slot)
    if (donePlayers.includes(player.id)) continue
    if (!hasLegalPick(next, player.id, units)) {
      donePlayers.push(player.id)
      next = { ...next, donePlayers }
      continue
    }
    return { ...next, slot, turnStartedAt: now }
  }
}

export function startDraft(settings: DraftSettings, pool: Record<string, number>, units: UnitIndex, now: number): DraftState {
  const initial: DraftState = {
    settings,
    pool,
    picks: [],
    donePlayers: [],
    slot: 0,
    status: 'drafting',
    turnStartedAt: now,
  }
  return advance(initial, 0, units, now)
}

export class DraftError extends Error {}

function record(state: DraftState, playerId: string, kind: PickKind, unitId: string | null): Pick {
  return { playerId, kind, unitId, slot: state.slot }
}

export function makePick(state: DraftState, playerId: string, unitId: string, units: UnitIndex, now: number): DraftState {
  const player = currentPlayer(state)
  if (!player || player.id !== playerId) throw new DraftError("It isn't your turn")
  const unit = units.get(unitId)
  if (!unit || !(unitId in state.pool)) throw new DraftError('That unit is not in the pool')
  const check = checkUnit(state, playerId, unit, units)
  if (!check.ok) throw new DraftError(check.reason)

  const next = { ...state, picks: [...state.picks, record(state, playerId, 'pick', unitId)] }
  return advance(next, state.slot + 1, units, now)
}

/** The player is finished drafting and drops out of the rotation. */
export function passDraft(state: DraftState, playerId: string, units: UnitIndex, now: number): DraftState {
  const player = currentPlayer(state)
  if (!player || player.id !== playerId) throw new DraftError("It isn't your turn")
  const next = {
    ...state,
    picks: [...state.picks, record(state, playerId, 'pass', null)],
    donePlayers: [...state.donePlayers, playerId],
  }
  return advance(next, state.slot + 1, units, now)
}

/** The pick timer ran out: the player loses this pick but stays in the draft. */
export function timeoutPick(state: DraftState, units: UnitIndex, now: number): DraftState {
  const player = currentPlayer(state)
  if (!player) return state
  const next = { ...state, picks: [...state.picks, record(state, player.id, 'timeout', null)] }
  return advance(next, state.slot + 1, units, now)
}

/** Replays every pick except the last. Handy for fixing a misclick. */
export function undoLast(state: DraftState, units: UnitIndex, now: number): DraftState {
  let replay = startDraft(state.settings, state.pool, units, now)
  for (const p of state.picks.slice(0, -1)) {
    if (p.kind === 'pick') replay = makePick(replay, p.playerId, p.unitId!, units, now)
    else if (p.kind === 'pass') replay = passDraft(replay, p.playerId, units, now)
    else replay = timeoutPick(replay, units, now)
  }
  return replay
}

export function timeLeft(state: DraftState, now: number): number | null {
  const { timerSeconds } = state.settings
  if (timerSeconds === null || state.status !== 'drafting') return null
  return Math.max(0, timerSeconds - Math.floor((now - state.turnStartedAt) / 1000))
}
