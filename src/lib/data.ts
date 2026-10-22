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
}

const collectionFiles = import.meta.glob<CollectionFile>('../data/collections/*.json', { eager: true, import: 'default' })

/** Collections keyed by HeroScape Helper username. */
export const collections: Record<string, Record<string, number>> = Object.fromEntries(
  Object.entries(collectionFiles).map(([path, file]) => [path.split('/').pop()!.replace(/\.json$/, ''), file.units]),
)
