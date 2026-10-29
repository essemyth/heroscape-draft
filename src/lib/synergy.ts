// Synergies between units, from src/data/synergies.json (built by scripts/build-synergies.mjs).

import synergyData from '../data/synergies.json'
import type { Unit } from './types'

type Attr = 'species' | 'unitClass' | 'personality' | 'general' | 'type' | 'rarity'

export interface SynergyRef {
  power: string
  kind: 'units' | 'terms'
  /** What the power names, e.g. "Kyrie" or "Deathwalker 9000". */
  label: string
  ids?: string[]
  terms?: Partial<Record<Attr, string>> & { minRange?: number; sizes?: string[] }
  /** The named units help this one, rather than the other way round (e.g. Feed the Forge). */
  reverse?: boolean
  /** What the power does for the units it helps: "Atk boost", "Bonding", "Healing", ... */
  effects?: string[]
}

const refsByUnit = synergyData as Record<string, SynergyRef[]>
const refsOf = (unitId: string) => refsByUnit[unitId] ?? []

const values = (v: string) =>
  v
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Singular, lowercase form, so "Soulborg Guards" in power text matches the class "Guard". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ies$/, 'y')
    .replace(/ves$/, 'f')
    .replace(/men$/, 'man')
    .replace(/s$/, '')

function refMatches(ref: SynergyRef, target: Unit): boolean {
  if (ref.kind === 'units') return ref.ids!.includes(target.id)
  const { minRange, sizes, ...terms } = ref.terms!
  if (minRange !== undefined && target.range < minRange) return false
  if (sizes && !sizes.includes(target.size.toLowerCase())) return false
  return Object.entries(terms).every(([attr, value]) =>
    values(target[attr as Attr] ?? '').some((v) => norm(v) === norm(String(value))),
  )
}

export interface Boost {
  power: string
  effects: string[]
  label: string
  units: Unit[]
}

export interface HelpingPower {
  power: string
  effects: string[]
}

export interface BoostedBy {
  unit: Unit
  powers: HelpingPower[]
}

/** How `unit` relates to the other `candidates`: whom its powers help, and whose powers help it. */
export function synergiesFor(unit: Unit, candidates: Unit[]): { boosts: Boost[]; boostedBy: BoostedBy[] } {
  const others = candidates.filter((c) => c.id !== unit.id)

  // This unit's powers that help others.
  const boosts: Boost[] = refsOf(unit.id)
    .filter((ref) => !ref.reverse)
    .map((ref) => ({ power: ref.power, effects: ref.effects ?? [], label: ref.label, units: others.filter((c) => refMatches(ref, c)) }))
    .filter((b) => b.units.length > 0)
  // Others' powers that this unit feeds ("Feed the Forge": a destroyed Soulborg heals Hellforge).
  for (const c of others) {
    for (const ref of refsOf(c.id)) {
      if (ref.reverse && refMatches(ref, unit)) boosts.push({ power: ref.power, effects: ref.effects ?? [], label: c.name, units: [c] })
    }
  }

  const helpers = new Map<string, BoostedBy>()
  const add = (u: Unit, ref: SynergyRef) => {
    const entry = helpers.get(u.id) ?? { unit: u, powers: [] }
    if (!entry.powers.some((p) => p.power === ref.power)) entry.powers.push({ power: ref.power, effects: ref.effects ?? [] })
    helpers.set(u.id, entry)
  }
  for (const c of others) {
    for (const ref of refsOf(c.id)) if (!ref.reverse && refMatches(ref, unit)) add(c, ref)
  }
  for (const ref of refsOf(unit.id)) {
    if (ref.reverse) for (const c of others) if (refMatches(ref, c)) add(c, ref)
  }
  return { boosts, boostedBy: [...helpers.values()] }
}

/** Distinct units in `army` linked to `unit` in either direction. */
export function linkedInArmy(unit: Unit, army: Unit[]): Unit[] {
  const linked = new Map<string, Unit>()
  for (const other of army) {
    if (other.id === unit.id) continue
    const forward = refsOf(unit.id).some((ref) => refMatches(ref, other))
    const backward = refsOf(other.id).some((ref) => refMatches(ref, unit))
    if (forward || backward) linked.set(other.id, other)
  }
  return [...linked.values()]
}
