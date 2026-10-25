// Imports a user's owned units from their public HeroScape Helper collection page
// and maps them onto our unit ids (src/data/units.json).
//
// Usage: npm run import-collection -- <heroscapehelper-username>
// Writes src/data/collections/<username>.json

import { readFile, writeFile, mkdir } from 'node:fs/promises'

const username = process.argv[2]
if (!username) {
  console.error('Usage: npm run import-collection -- <heroscapehelper-username>')
  process.exit(1)
}

const pageUrl = `https://heroscapehelper.com/users/${encodeURIComponent(username)}/collection?ownership=owned`
const unitsFile = new URL('../src/data/units.json', import.meta.url)
const outFile = new URL(`../src/data/collections/${username}.json`, import.meta.url)

const res = await fetch(pageUrl)
if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
// The data is embedded as escaped JSON inside the Next.js payload; unescape one level.
const page = (await res.text()).replace(/\\(["\\])/g, '$1')

// Collection entries: { unit_id, user_id, quantity, ... }
const owned = [...page.matchAll(/\{"unit_id":"([0-9a-f-]{36})","user_id":"[^"]*","quantity":(\d+)/g)]
  .map((m) => ({ hshId: m[1], quantity: Number(m[2]) }))
if (owned.length === 0) throw new Error('No collection entries found; is the collection public?')

// HeroScape Helper's unit records, used to identify each owned unit.
const hshUnits = new Map()
const unitRe =
  /\{"name":"((?:[^"\\]|\\.)*)","id":"([0-9a-f-]{36})","points":(\d+|null),[^{}]*?"attack":(\d+|null),"defense":(\d+|null),"life":(\d+|null),"move":(\d+|null)/g
for (const m of page.matchAll(unitRe)) {
  if (hshUnits.has(m[2])) continue
  hshUnits.set(m[2], {
    name: JSON.parse(`"${m[1]}"`),
    points: Number(m[3]),
    attack: Number(m[4]),
    defense: Number(m[5]),
    life: Number(m[6]),
    move: Number(m[7]),
  })
}

// HeroScape Helper names versions by set, e.g. "Raelin the Kyrie Warrior (SotM)";
// heroscape.org numbers them, e.g. "Raelin the Kyrie Warrior (2.0)". Match on the base
// name, then break ties with cost and stats.
const baseName = (name) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '')
const { units } = JSON.parse(await readFile(unitsFile, 'utf8'))

function findUnit(hsh) {
  let candidates = units.filter((u) => baseName(u.name) === baseName(hsh.name))
  if (candidates.length > 1) {
    candidates = candidates.filter(
      (u) =>
        u.cost.normal === hsh.points &&
        u.life === hsh.life &&
        u.move === hsh.move &&
        u.attack === hsh.attack &&
        u.defense === hsh.defense,
    )
  }
  return candidates.length === 1 ? candidates[0] : null
}

const collection = {}
const unmatched = []
for (const { hshId, quantity } of owned) {
  const hsh = hshUnits.get(hshId)
  const unit = hsh && findUnit(hsh)
  if (unit) collection[unit.id] = (collection[unit.id] ?? 0) + quantity
  else unmatched.push({ hshId, name: hsh?.name ?? null, quantity })
}

// Units owned but missing from HeroScape Helper: src/data/collection-extras/<username>.json,
// { "<unit-id>": <copies> }. Added on top of what HeroScape Helper lists.
const extrasFile = new URL(`../src/data/collection-extras/${username}.json`, import.meta.url)
const extras = await readFile(extrasFile, 'utf8').then(JSON.parse, () => ({}))
for (const [id, qty] of Object.entries(extras)) {
  if (!units.some((u) => u.id === id)) {
    console.warn(`Extra unit "${id}" isn't a known unit id; skipped`)
    continue
  }
  collection[id] = (collection[id] ?? 0) + qty
}

await mkdir(new URL('.', outFile), { recursive: true })
await writeFile(
  outFile,
  JSON.stringify({ source: pageUrl, importedAt: new Date().toISOString(), units: collection, unmatched }, null, 2) + '\n',
)

const cards = Object.values(collection).reduce((a, b) => a + b, 0)
console.log(`Matched ${Object.keys(collection).length} units (${cards} cards) -> src/data/collections/${username}.json`)
if (unmatched.length) {
  console.log(`Unmatched (${unmatched.length}):`)
  for (const u of unmatched) console.log(`  ${u.name ?? u.hshId} x${u.quantity}`)
}
