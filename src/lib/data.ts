import unitData from '../data/units.json'
import type { Unit } from './types'
import type { UnitIndex } from './draft'

export const units = unitData.units as Unit[]
export const unitIndex: UnitIndex = new Map(units.map((u) => [u.id, u]))

export const ALL_GROUPS = [...new Set(units.map((u) => u.group))].sort()
export const DEFAULT_GROUPS = ['Hasbro', 'Renegade', 'Prerelease']

// Unit photos live in src/assets/units/<unit-id>.<ext>; only files that exist are bundled.
const imageFiles = import.meta.glob<string>('../assets/units/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const unitImages: Record<string, string> = Object.fromEntries(
  Object.entries(imageFiles).map(([path, url]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), url]),
)

interface CollectionFile {
  units: Record<string, number>
  /** When each unit first appeared in the collection (YYYY-MM-DD); older units have no date. */
  added?: Record<string, string>
}

const collectionFiles = import.meta.glob<CollectionFile>('../data/collections/*.json', { eager: true, import: 'default' })
const collectionName = (path: string) => path.split('/').pop()!.replace(/\.json$/, '')

/** Collections keyed by HeroScape Helper username. */
export const collections: Record<string, Record<string, number>> = Object.fromEntries(
  Object.entries(collectionFiles).map(([path, file]) => [collectionName(path), file.units]),
)

const addedDates: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(collectionFiles).map(([path, file]) => [collectionName(path), file.added ?? {}]),
)

/** Figures count as new for this long after they're added to a collection. */
export const NEW_FOR_DAYS = 30

/** Units added to a collection within the last 30 days, with the day each was added. */
export function newUnitsIn(collectionId: string, now = Date.now()): Map<string, Date> {
  const out = new Map<string, Date>()
  for (const [id, day] of Object.entries(addedDates[collectionId] ?? {})) {
    const date = new Date(`${day}T00:00:00`)
    if (now - date.getTime() < NEW_FOR_DAYS * 24 * 60 * 60 * 1000) out.set(id, date)
  }
  return out
}
