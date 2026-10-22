import { describe, expect, it } from 'vitest'
import {
  DraftError,
  armyOf,
  buildPool,
  currentPlayer,
  makePick,
  passDraft,
  playerForSlot,
  pointsOf,
  remainingCount,
  startDraft,
  timeLeft,
  timeoutPick,
  undoLast,
  type UnitIndex,
} from './draft'
import type { DraftSettings, Rarity, Unit } from './types'

function unit(id: string, cost: number | null, rarity: Rarity = 'Common', extra: Partial<Unit> = {}): Unit {
  return {
    id,
    name: id,
    group: 'Hasbro',
    set: '',
    releaseDate: '',
    rarity,
    type: rarity === 'Unique' ? 'Hero' : 'Squad',
    general: 'Jandar',
    homeworld: '',
    species: '',
    unitClass: '',
    personality: '',
    size: '',
    height: 5,
    figures: 1,
    hexes: 1,
    life: 1,
    move: 5,
    range: 1,
    attack: 3,
    defense: 3,
    powers: [],
    cost: { normal: cost, renegade: null, deltaClassic: cost, deltaVc: cost },
    heroscapersUrl: null,
    ...extra,
  }
}

const units: UnitIndex = new Map(
  [
    unit('big', 200, 'Unique'),
    unit('mid', 100, 'Unique'),
    unit('squad', 50),
    unit('cheap', 10),
    unit('syv1', 100, 'Unique', { name: 'Syvarris (1.0)' }),
    unit('syv2', 120, 'Unique', { name: 'Syvarris (2.0)' }),
    unit('nocost', null),
  ].map((u) => [u.id, u]),
)

const players = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
]

function settings(over: Partial<DraftSettings> = {}): DraftSettings {
  return { format: 'normal', pointsTotal: 300, groups: ['Hasbro'], timerSeconds: null, players, collectionId: 'x', ...over }
}

describe('snake order', () => {
  it('goes forward then backward', () => {
    const order = Array.from({ length: 9 }, (_, i) => playerForSlot(players, i).id).join('')
    expect(order).toBe('abccbaabc')
  })
})

describe('buildPool', () => {
  it('drops units without a cost in the format and outside the groups', () => {
    const pool = buildPool({ big: 1, nocost: 2, squad: 3 }, units, settings())
    expect(pool).toEqual({ big: 1, squad: 3 })
    expect(buildPool({ big: 1 }, units, settings({ groups: ['Marvel'] }))).toEqual({})
  })
})

describe('picking', () => {
  it('enforces turn order and pool counts', () => {
    let s = startDraft(settings(), { squad: 2, big: 1 }, units, 0)
    expect(currentPlayer(s)?.id).toBe('a')
    expect(() => makePick(s, 'b', 'squad', units, 0)).toThrow(DraftError)

    s = makePick(s, 'a', 'squad', units, 0)
    s = makePick(s, 'b', 'squad', units, 0)
    expect(remainingCount(s, 'squad')).toBe(0)
    expect(() => makePick(s, 'c', 'squad', units, 0)).toThrow('None left')
  })

  it('rejects picks over the points total', () => {
    let s = startDraft(settings({ pointsTotal: 250, players: players.slice(0, 1) }), { big: 2, squad: 5 }, units, 0)
    s = makePick(s, 'a', 'big', units, 0)
    expect(() => makePick(s, 'a', 'big', units, 0)).toThrow('Costs 200, you have 50 left')
    s = makePick(s, 'a', 'squad', units, 0) // exactly 250
    expect(pointsOf(armyOf(s, 'a', units), 'normal')).toBe(250)
    expect(s.status).toBe('complete')
  })

  it('allows only one version of a unique hero', () => {
    let s = startDraft(settings({ players: players.slice(0, 2) }), { syv1: 1, syv2: 1, cheap: 5 }, units, 0)
    s = makePick(s, 'a', 'syv1', units, 0)
    s = makePick(s, 'b', 'cheap', units, 0)
    s = makePick(s, 'b', 'cheap', units, 0)
    expect(() => makePick(s, 'a', 'syv2', units, 0)).toThrow('Already have Syvarris (1.0)')
  })

  it('allows multiple copies of commons', () => {
    let s = startDraft(settings({ players: players.slice(0, 1) }), { squad: 3 }, units, 0)
    s = makePick(s, 'a', 'squad', units, 0)
    s = makePick(s, 'a', 'squad', units, 0)
    expect(armyOf(s, 'a', units).map((u) => u.id)).toEqual(['squad', 'squad'])
  })
})

describe('finishing', () => {
  it('skips players who passed and completes when all are done', () => {
    let s = startDraft(settings(), { cheap: 20 }, units, 0)
    s = passDraft(s, 'a', units, 0)
    expect(currentPlayer(s)?.id).toBe('b')
    s = makePick(s, 'b', 'cheap', units, 0)
    s = makePick(s, 'c', 'cheap', units, 0)
    s = makePick(s, 'c', 'cheap', units, 0)
    // Snake would return to a, who is done, so b is next.
    expect(currentPlayer(s)?.id).toBe('b')
    s = passDraft(s, 'b', units, 0)
    s = passDraft(s, 'c', units, 0)
    expect(s.status).toBe('complete')
    expect(currentPlayer(s)).toBeNull()
  })

  it('auto-finishes players who cannot afford anything', () => {
    let s = startDraft(settings({ pointsTotal: 100, players: players.slice(0, 2) }), { mid: 1, squad: 1, cheap: 1 }, units, 0)
    s = makePick(s, 'a', 'mid', units, 0) // a is full
    s = makePick(s, 'b', 'squad', units, 0)
    s = makePick(s, 'b', 'cheap', units, 0)
    // Pool is empty: everyone is done.
    expect(s.status).toBe('complete')
    expect(s.donePlayers.sort()).toEqual(['a', 'b'])
  })

  it('completes immediately when the pool is empty', () => {
    expect(startDraft(settings(), {}, units, 0).status).toBe('complete')
  })
})

describe('timer and undo', () => {
  it('times out a pick without removing the player', () => {
    let s = startDraft(settings({ timerSeconds: 30 }), { cheap: 10 }, units, 1_000)
    expect(timeLeft(s, 11_000)).toBe(20)
    s = timeoutPick(s, units, 31_000)
    expect(currentPlayer(s)?.id).toBe('b')
    expect(s.donePlayers).toEqual([])
    expect(timeLeft(s, 31_000)).toBe(30)
  })

  it('undoes the last pick', () => {
    let s = startDraft(settings(), { squad: 2 }, units, 0)
    s = makePick(s, 'a', 'squad', units, 0)
    s = makePick(s, 'b', 'squad', units, 0)
    s = undoLast(s, units, 0)
    expect(currentPlayer(s)?.id).toBe('b')
    expect(remainingCount(s, 'squad')).toBe(1)
  })
})
