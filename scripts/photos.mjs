// Turns raw figure photos into web-sized images the app uses.
//
// 1. Put photos in photos/ named after the unit id, e.g. photos/agent-carr-10.jpg
//    (any of jpg, jpeg, png, webp, heic; case doesn't matter).
// 2. Run `npm run photos`.
//
// Each photo is cropped to 8:5, resized to 800x500 and saved as src/assets/units/<id>.webp.
// Also writes photos/CHECKLIST.md listing which of your units still need a photo.

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = new URL('../', import.meta.url)
const inDir = new URL('photos/', root)
const outDir = new URL('src/assets/units/', root)
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic'])

const { units } = JSON.parse(await readFile(new URL('src/data/units.json', root), 'utf8'))
const byId = new Map(units.map((u) => [u.id, u]))

await mkdir(inDir, { recursive: true })
await mkdir(outDir, { recursive: true })

let made = 0
const unknown = []
const failed = []
for (const file of await readdir(inDir)) {
  const dot = file.lastIndexOf('.')
  const ext = file.slice(dot).toLowerCase()
  if (dot < 0 || !EXTS.has(ext)) continue
  const id = file.slice(0, dot).toLowerCase()
  if (!byId.has(id)) {
    unknown.push(file)
    continue
  }
  const src = new URL(file, inDir)
  const dest = new URL(`${id}.webp`, outDir)
  // Skip photos that haven't changed since they were last converted.
  const done = await stat(dest).catch(() => null)
  if (done && done.mtimeMs >= (await stat(src)).mtimeMs) continue
  try {
    await sharp(await readFile(src))
      .rotate() // respect the phone's orientation
      .resize(800, 500, { fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toFile(fileURLToPath(dest))
    made++
  } catch (e) {
    failed.push(`${file} (${e.message})`)
  }
}

// Checklist of owned units, across every imported collection.
const owned = new Set()
const collectionsDir = new URL('src/data/collections/', root)
for (const f of await readdir(collectionsDir)) {
  if (!f.endsWith('.json')) continue
  const { units: c } = JSON.parse(await readFile(new URL(f, collectionsDir), 'utf8'))
  for (const id of Object.keys(c)) owned.add(id)
}
const have = new Set((await readdir(outDir)).map((f) => f.replace(/\.\w+$/, '')))
const rows = [...owned]
  .map((id) => byId.get(id))
  .filter(Boolean)
  .sort((a, b) => a.general.localeCompare(b.general) || a.name.localeCompare(b.name))
const missing = rows.filter((u) => !have.has(u.id))

const lines = [
  '# Photo checklist',
  '',
  `${rows.length - missing.length} of ${rows.length} units have photos. Save each photo in this folder with the file name shown.`,
  '',
  '| Done | Unit | General | File name |',
  '|---|---|---|---|',
  ...rows.map((u) => `| ${have.has(u.id) ? '✅' : '⬜'} | ${u.name} | ${u.general} | \`${u.id}.jpg\` |`),
  '',
]
await writeFile(new URL('CHECKLIST.md', inDir), lines.join('\n'))

console.log(`Converted ${made} photo(s). ${rows.length - missing.length}/${rows.length} owned units have photos.`)
console.log('See photos/CHECKLIST.md for what is left.')
if (failed.length) console.log(`Could not convert: ${failed.join(', ')}`)
if (unknown.length) console.log(`Not a unit id (check the name): ${unknown.join(', ')}`)
