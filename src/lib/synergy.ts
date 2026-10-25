// Synergies between units, from src/data/synergies.json (built by scripts/build-synergies.mjs).

import synergyData from '../data/synergies.json'
import type { Unit } from './types'

type Attr = 'species' | 'unitClass' | 'personality' | 'general' | 'type'

export interface SynergyRef {
  power: string
  kind: 'units' | 'terms'
  /** What the power names, e.g. "Kyrie" or "Deathwalker 9000". */
  label: string
  ids?: string[]
  terms?: Partial<Record<Attr, string>>
}

const refsByUnit = synergyData as Record<string, SynergyRef[]>

const values = (v: string) =>
  v
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean)

function refMatches(ref: SynergyRef, target: Unit): boolean {
  if (ref.kind === 'units') return ref.ids!.includes(target.id)
  return Object.entries(ref.terms!).every(([attr, value]) => values(target[attr as Attr] ?? '').includes(value))
}

export interface Boost {
  power: string
  label: string
  units: Unit[]
}

export interface BoostedBy {
  unit: Unit
  powers: string[]
}

/** How `unit` relates to the other `candidates`: whom its powers help, and whose powers help it. */
export function synergiesFor(unit: Unit, candidates: Unit[]): { boosts: Boost[]; boostedBy: BoostedBy[] } {
  const others = candidates.filter((c) => c.id !== unit.id)

  const boosts = (refsByUnit[unit.id] ?? [])
    .map((ref) => ({ power: ref.power, label: ref.label, units: others.filter((c) => refMatches(ref, c)) }))
    .filter((b) => b.units.length > 0)

  const boostedBy: BoostedBy[] = []
  for (const c of others) {
    const powers = [...new Set((refsByUnit[c.id] ?? []).filter((ref) => refMatches(ref, unit)).map((ref) => ref.power))]
    if (powers.length) boostedBy.push({ unit: c, powers })
  }
  return { boosts, boostedBy }
}

/** Distinct units in `army` linked to `unit` in either direction. */
export function linkedInArmy(unit: Unit, army: Unit[]): Unit[] {
  const linked = new Map<string, Unit>()
  for (const other of army) {
    if (other.id === unit.id) continue
    const forward = (refsByUnit[unit.id] ?? []).some((ref) => refMatches(ref, other))
    const backward = (refsByUnit[other.id] ?? []).some((ref) => refMatches(ref, unit))
    if (forward || backward) linked.set(other.id, other)
  }
  return [...linked.values()]
}
