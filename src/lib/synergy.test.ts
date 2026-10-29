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
  it('finds a named group, singular or plural, with its range condition (Deathwalker 9000 -> Soulborg Guards)', () => {
    const dw = byName('Deathwalker 9000')
    const candidates = ['Blastatrons', 'Zettian Guards', 'Deflectatron', 'Agent Carr (1.0)'].map(byName)
    const helped = synergiesFor(dw, [dw, ...candidates]).boosts.flatMap((b) => b.units.map((u) => u.name))
    // Deflectatron is a Soulborg Guard but has Range 1; the power needs Range 4 or more.
    expect(helped.sort()).toEqual(['Blastatrons', 'Zettian Guards'])
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
    const ownPowers = new Set(tenth.powers.map((p) => p.name))
    expect(synergiesFor(tenth, [tenth, ...soldiers]).boosts.filter((b) => ownPowers.has(b.power))).toEqual([])
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

  it('respects size limits ("small or medium Elementals")', () => {
    const kurrok = byName('Kurrok the Elementalist')
    const elementals = ['Water Elemental', 'Greater Ice Elemental'].map(byName)
    for (const b of synergiesFor(kurrok, elementals).boosts) expect(b.units.map((u) => u.name)).toEqual(['Water Elemental'])
  })

  it('finds Marro Hive squads by size and rarity', () => {
    const hive = byName('Marro Hive')
    const marro = ['Marro Drudge', 'Grok Riders', 'Marro Warriors'].map(byName)
    const byPower = Object.fromEntries(synergiesFor(hive, marro).boosts.map((b) => [b.power, b.units.map((u) => u.name).sort()]))
    expect(byPower['HIVE MIND']).toEqual(['Marro Drudge']) // Grok Riders are large
    expect(byPower['MARRO REBIRTH']).toEqual(['Grok Riders', 'Marro Drudge']) // Marro Warriors are unique
  })

  it('shows reversed links (destroyed Soulborgs feed Hellforge Mandukor)', () => {
    const hellforge = byName('Hellforge Mandukor')
    const soulborg = byName('Blastatrons')
    expect(synergiesFor(hellforge, [soulborg]).boosts).toEqual([])
    expect(synergiesFor(hellforge, [soulborg]).boostedBy.map((b) => b.unit)).toEqual([soulborg])
    expect(synergiesFor(soulborg, [hellforge]).boosts.map((b) => b.units)).toEqual([[hellforge]])
  })

  it('ignores "Sonlen\'s Dragon" and the Lizard King title', () => {
    expect(synergiesFor(byName('Sonlen (1.0)'), [byName('Mimring')]).boosts).toEqual([])
    const scions = byName('Scions of Icaria')
    const greenscale = byName('Greenscale Warriors')
    expect(synergiesFor(scions, [greenscale]).boosts).toEqual([])
    expect(synergiesFor(greenscale, [scions]).boosts).toEqual([])
  })

  it('tags how a unit is helped', () => {
    const bladeGruts = byName('Blade Gruts')
    const helpers = synergiesFor(bladeGruts, ['Grimnak', 'Torin'].map(byName)).boostedBy
    const how = Object.fromEntries(helpers.map((h) => [h.unit.name, h.powers.flatMap((p) => p.effects)]))
    expect(how['Grimnak']).toEqual(['Atk boost', 'Def boost'])
    expect(how['Torin']).toEqual(['Retaliation'])
  })

  it('flips powers where the bonus goes to the unit itself (Sir Dupuis gains from Knights)', () => {
    const dupuis = byName('Sir Dupuis')
    const knight = byName('Knights of Weston')
    expect(synergiesFor(dupuis, [knight]).boostedBy.map((b) => b.unit)).toEqual([knight])
    expect(synergiesFor(knight, [dupuis]).boosts.map((b) => [b.power, b.effects])).toEqual([["KNIGHT'S COURAGE", ['Atk boost']]])
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
