// Pulls the unit list (stats, powers, Normal/Delta/Renegade costs) from the
// heroscape.org army builder and writes a normalized snapshot to src/data/units.json.
// Re-run with `npm run import-units` whenever Delta costs change.
//
// Data courtesy of heroscape.org (Chris Perkins' Autoload Builder).

import { writeFile, mkdir } from 'node:fs/promises'

const SOURCE_URL = 'https://heroscape.org/builder/'
const OUT_FILE = new URL('../src/data/units.json', import.meta.url)

// Costs come through as numbers, numeric strings, "" or null. Normalize to number | null.
function cost(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function powers(raw) {
  const list = []
  for (let i = 1; i <= 4; i++) {
    const name = raw[`special_power_${i}_name`]
    const text = raw[`special_power_${i}_text`]
    if (name || text) list.push({ name: name ?? '', text: text ?? '' })
  }
  return list
}

function normalize(raw) {
  return {
    id: raw.slug,
    name: raw.unit_name,
    group: raw.unit_group,
    set: raw.release_set,
    releaseDate: raw.release_set_date,
    rarity: raw.rarity,
    type: raw.type,
    general: raw.general,
    homeworld: raw.homeworld,
    species: raw.species,
    unitClass: raw.unit_class,
    personality: raw.personality,
    size: raw.size,
    height: raw.height,
    figures: raw.figures,
    hexes: raw.hexes,
    life: raw.life,
    move: raw.move,
    range: raw.range,
    attack: raw.attack,
    defense: raw.defense,
    powers: powers(raw),
    cost: {
      normal: cost(raw.points_standard),
      renegade: cost(raw.points_renegade_points),
      deltaClassic: cost(raw.points_delta_classic),
      deltaVc: cost(raw.points_delta_vc),
    },
    heroscapersUrl: raw.heroscapers_url ?? null,
  }
}

const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
const html = await res.text()

const match = html.match(/<script id="unit-data" type="application\/json">([\s\S]*?)<\/script>/)
if (!match) throw new Error('Could not find unit-data block; the page layout may have changed.')

const units = JSON.parse(match[1])
  .map(normalize)
  .sort((a, b) => a.name.localeCompare(b.name))

await mkdir(new URL('.', OUT_FILE), { recursive: true })
await writeFile(OUT_FILE, JSON.stringify({ source: SOURCE_URL, importedAt: new Date().toISOString(), units }, null, 2) + '\n')

const groups = {}
for (const u of units) groups[u.group] = (groups[u.group] ?? 0) + 1
console.log(`Wrote ${units.length} units to src/data/units.json`)
console.log(groups)
