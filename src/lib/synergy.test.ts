import { describe, expect, it } from 'vitest'
import unitData from '../data/units.json'
import { linkedInArmy, synergiesFor } from './synergy'
import type { Unit } from './types'

const units = unitData.units as Unit[]
const byName = (name: string) => {
  const u = units.find((x) => x.name === name)
  if (!u) throw new Error(`No unit ${name}`)
  return u
}

describe('synergies from real power text', () => {
  it('finds a named compound group (Deathwalker 9000 -> Soulborg Guards)', () => {
    const dw = byName('Deathwalker 9000')
    const guards = units.filter((u) => u.species === 'Soulborg' && u.unitClass === 'Guards')
    const other = byName('Agent Carr (1.0)')
    const { boosts } = synergiesFor(dw, [dw, ...guards, other])
    expect(boosts.flatMap((b) => b.units.map((u) => u.id)).sort()).toEqual(guards.map((u) => u.id).sort())
  })

  it('works in both directions', () => {
    const atlaga = byName('Atlaga the Kyrie Warrior')
    const raelin = byName('Raelin the Kyrie Warrior (1.0)')
    expect(synergiesFor(atlaga, [raelin]).boosts[0]?.units).toEqual([raelin])
    expect(synergiesFor(raelin, [atlaga]).boostedBy.map((b) => b.unit)).toEqual([atlaga])
    expect(linkedInArmy(raelin, [atlaga])).toEqual([atlaga])
  })

  it('ignores a squad talking about itself', () => {
    const marro = byName('Marro Warriors')
    const others = units.filter((u) => u.species === 'Marro' && u.id !== marro.id)
    expect(synergiesFor(marro, [marro, ...others]).boosts).toEqual([])
  })

  it('ignores powers describing the unit itself ("a Soldier in the 10th Regiment of Foot")', () => {
    const tenth = byName('10th Regiment of Foot')
    const soldiers = units.filter((u) => u.unitClass === 'Soldier' && u.id !== tenth.id)
    expect(synergiesFor(tenth, [tenth, ...soldiers]).boosts).toEqual([])
    // ...while a leader that boosts soldiers still counts.
    const marcus = byName('Marcus Decimus Gallus')
    expect(synergiesFor(tenth, [marcus]).boostedBy.map((b) => b.unit)).toEqual([marcus])
  })

  it('keeps references that reach other units ("a Unique Warrior Hero that follows Revna")', () => {
    const misaerx = byName('Misaerx the Kyrie Warrior')
    const targets = units.filter((u) => u.unitClass === 'Warrior' && u.general === 'Revna' && u.id !== misaerx.id)
    expect(synergiesFor(misaerx, targets).boosts.length).toBeGreaterThan(0)
  })

  it('finds lowercase personalities and named powers (Khosumet -> Anubian Wolves)', () => {
    const khosumet = byName('Khosumet the Darklord')
    const wolves = byName('Anubian Wolves')
    const powers = synergiesFor(khosumet, [wolves]).boosts.map((b) => b.power).sort()
    expect(powers).toEqual(['RELENTLESS ASSAULT', 'UNLEASHED FURY ENHANCEMENT'])
    expect(synergiesFor(wolves, [khosumet]).boostedBy.map((b) => b.unit)).toEqual([khosumet])
  })

  it('treats targets of attacks as enemies, unless they are yours', () => {
    const brandis = byName('Brandis Skyhunter')
    const fliers = units.filter((u) => u.powers.some((p) => /^FLYING$/.test(p.name))).slice(0, 5)
    expect(synergiesFor(brandis, fliers).boosts).toEqual([])
    const bok = byName('Bok-Bur-Na')
    const pirates = units.filter((u) => u.unitClass === 'Pirate')
    expect(synergiesFor(bok, pirates).boosts.length).toBeGreaterThan(0)
  })

  it('ignores exclusions like "not affected by"', () => {
    const hounds = byName('Marrden Hounds')
    const wulsinu = units.filter((u) => u.species === 'Wulsinu')
    expect(synergiesFor(hounds, wulsinu).boosts).toEqual([])
  })

  it('never links a unit to itself', () => {
    const atlaga = byName('Atlaga the Kyrie Warrior')
    expect(linkedInArmy(atlaga, [atlaga])).toEqual([])
  })
})
