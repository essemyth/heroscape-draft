// Finds synergies in power text and writes src/data/synergies.json.
//
// A power "references" other units when its text names them directly ("Finn", "Deathwalker 9000")
// or names a group they belong to ("Kyrie Warriors", "Soulborgs", "Valiant", "Utgar's").
// The app combines these references with the draft pool to show what boosts what.
//
// Hand fixes live in src/data/synergy-overrides.json. Run `npm run synergies` after editing it
// (import-units runs this automatically).

import { readFile, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const { units } = JSON.parse(await readFile(new URL('src/data/units.json', root), 'utf8'))
const overrides = JSON.parse(await readFile(new URL('src/data/synergy-overrides.json', root), 'utf8'))

const ATTRS = ['species', 'unitClass', 'personality', 'general']
// Attribute values too vague to mean anything in power text.
const IGNORED_VALUES = new Set(['Varied', 'Unaffiliated', 'Unique', 'Creature', 'Hero', 'Squad', 'Marvel', 'Unknown', 'Count'])

// First names that are really titles or ordinary words, so they never count as a hero reference.
const COMMON_WORDS = new Set(['Agent', 'Captain', 'Major', 'General', 'Lord', 'Lady', 'King', 'Queen', 'Prince', 'Princess', 'Doctor', 'Master', 'Mister', 'Sergeant', 'Brother', 'Sister', 'Father', 'Mother', 'Grand', 'High', 'Iron', 'Black', 'White', 'Dark', 'Fire', 'Storm', 'Shadow', 'Death', 'Dread', 'Elite', 'Young', 'Old', 'Each', 'When', 'After', 'Before', 'Your', 'This'])

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const baseName = (name) => name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
const singular = (w) => w.replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/men$/, 'man').replace(/s$/, '')
function forms(w) {
  return [...new Set([w, `${w}s`, `${w}es`, w.replace(/y$/, 'ies'), w.replace(/f$/, 'ves'), w.replace(/man$/, 'men'), `${w}'s`])]
}
function splitValues(v) {
  return String(v ?? '')
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2 && !IGNORED_VALUES.has(s))
}

// --- Vocabulary -------------------------------------------------------------------------------

const vocab = [] // { attr, value, re }
for (const attr of ATTRS) {
  const values = new Set(units.flatMap((u) => splitValues(u[attr])))
  for (const value of values) {
    // Case-sensitive: these are capitalized keywords on the cards ("Valiant", "Kyrie").
    vocab.push({ attr, value, re: new RegExp(`(?<![\\w-])(${forms(value).map(esc).join('|')})(?![\\w-])`, 'g') })
  }
}

// Direct unit references: full base names, plus distinctive first names of heroes ("Raelin", "Finn").
const byBase = new Map()
for (const u of units) {
  const b = baseName(u.name)
  if (!byBase.has(b)) byBase.set(b, [])
  byBase.get(b).push(u.id)
}
const vocabWords = new Set(vocab.flatMap((v) => forms(v.value)))
const firstWords = new Map()
for (const b of byBase.keys()) {
  const w = b.split(/[\s,]+/)[0]
  firstWords.set(w, (firstWords.get(w) ?? 0) + 1)
}
const nameRefs = [] // { label, ids, re }
for (const [b, ids] of byBase) {
  if (b.length < 4) continue
  nameRefs.push({ label: b, ids, re: new RegExp(`(?<![\\w-])${esc(b)}(?![\\w-])`, 'g') })
  // Short name: "Raelin" for "Raelin the Kyrie Warrior", "Drake" for "Sgt. Drake Alexander".
  // Plain names like "Water Elemental" don't get one, since "Water" is an ordinary word.
  const words = b.split(/[\s,]+/)
  const titled = words.length > 2 && (COMMON_WORDS.has(words[0]) || words[0].endsWith('.'))
  const short = / the |, /.test(b) ? words[0] : titled ? words[1] : null
  const isHero = ids.some((id) => units.find((u) => u.id === id).type === 'Hero')
  const distinctive = short && short.length >= 4 && /^[A-Z]/.test(short) && !vocabWords.has(short) && !COMMON_WORDS.has(short)
  if (isHero && distinctive && (firstWords.get(short) ?? 1) === 1) {
    nameRefs.push({ label: b, ids, re: new RegExp(`(?<![\\w-])${esc(short)}(?![\\w-])`, 'g') })
  }
}
// Longest names first so "Raelin the Kyrie Warrior" wins over "Raelin".
nameRefs.sort((a, b) => b.re.source.length - a.re.source.length)

// --- Matching ---------------------------------------------------------------------------------

/** True when the reference is about enemies or explicitly excluded, e.g. "non-Soulborg", "an opponent's Wizard". */
function isExcluded(text, index) {
  const before = text.slice(Math.max(0, index - 40), index)
  const clause = before.split(/[.;:]/).pop()
  // The whole sentence, for exclusions that come after the name ("Wulsinu are not affected").
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf(';', index)) + 1
  const end = text.slice(index).search(/[.;]/)
  const sentence = text.slice(start, end < 0 ? undefined : index + end)
  return (
    // "that Knight" / "this Knight" points back at the unit itself.
    /non-$|except\s+\S*\s*$|other than\s+\S*\s*$|\bnot\s+an?\s+$|\b(that|this)\s+$/i.test(before) ||
    /opponent|enemy|enemies|does not work against|cannot target|may not target/i.test(clause) ||
    /not affected|cannot|can't|immune|may not (?:use|attack|target)/i.test(sentence)
  )
}

// Text between a group word and a general that ties them together.
const FOLLOWS = /^\s+(?:(?:hero|squad|figure|army card|unit)e?s?\s+)?(?:you control\s+)?(?:who|that)\s+follows?\s+$/i

function blank(text, start, end) {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end)
}

function referencesIn(unit, power) {
  let text = power.text
  const refs = []

  // Power names aren't references ("Water Clone" is not the Clone species).
  for (const p of unit.powers) {
    if (p.name) text = text.replace(new RegExp(esc(p.name), 'gi'), (m) => ' '.repeat(m.length))
  }

  // The unit's own name isn't a synergy ("Marro Warriors" in the Marro Warriors' own powers).
  const own = baseName(unit.name)
  // Singular forms too: "a Knight of Scaeda" in the Knights of Scaeda's text.
  const ownSingular = own.split(' ').map(singular).join(' ')
  const ownFirstSingular = own.replace(/^(\S+)/, (w) => singular(w))
  for (const n of new Set([own, singular(own), ownSingular, ownFirstSingular, own.split(/[\s,]+/)[0]])) {
    if (n.length >= 3) text = text.replace(new RegExp(`(?<![\\w-])${esc(n)}(?:'s)?(?![\\w-])`, 'g'), (m) => ' '.repeat(m.length))
  }

  for (const ref of nameRefs) {
    for (const m of text.matchAll(ref.re)) {
      // Other versions of the same hero (Drake 1.0 in Drake 2.0's text) aren't synergies.
      if (!isExcluded(text, m.index) && ref.label !== own) refs.push({ kind: 'units', label: ref.label, ids: ref.ids })
      text = blank(text, m.index, m.index + m[0].length)
    }
  }

  // Attribute words; adjacent ones combine ("Kyrie Warriors" = Kyrie AND Warrior).
  const hits = []
  for (const v of vocab) for (const m of text.matchAll(v.re)) hits.push({ ...v, start: m.index, end: m.index + m[0].length })
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const groups = []
  for (const h of hits) {
    const last = groups.at(-1)
    const prev = last?.at(-1)
    const gap = prev ? text.slice(prev.end, h.start) : ''
    const fresh = last && !last.some((x) => x.attr === h.attr)
    if (prev && h.start < prev.end) continue // overlapping match, keep the first
    if (fresh && /^\s?$/.test(gap)) last.push(h)
    // "Soulborg you control who follows Vydar", "Tricky figure you control who follows Vydar".
    else if (fresh && h.attr === 'general' && FOLLOWS.test(gap)) last.push(h)
    else groups.push([h])
  }
  for (const g of groups) {
    if (isExcluded(text, g[0].start)) continue
    const terms = Object.fromEntries(g.map((h) => [h.attr, h.value]))
    refs.push({ kind: 'terms', label: g.map((h) => h.value).join(' '), terms })
  }

  // One entry per distinct reference.
  const seen = new Set()
  return refs
    .filter((r) => r.kind === 'terms' || r.ids.length)
    .filter((r) => {
      const key = `${r.kind}:${r.label}`
      return !seen.has(key) && seen.add(key)
    })
    .map((r) => ({ power: power.name, ...r }))
}

// --- Build ------------------------------------------------------------------------------------

const out = {}
let count = 0
for (const u of units) {
  let refs = u.powers.flatMap((p) => referencesIn(u, p))
  refs = refs.filter((r) => !overrides.remove.some((o) => o.unit === u.id && (!o.power || o.power === r.power) && (!o.label || o.label === r.label)))
  for (const a of overrides.add.filter((o) => o.unit === u.id)) {
    refs.push(a.ids ? { power: a.power, kind: 'units', label: a.label, ids: a.ids } : { power: a.power, kind: 'terms', label: a.label, terms: a.terms })
  }
  if (refs.length) {
    out[u.id] = refs
    count += refs.length
  }
}

await writeFile(new URL('src/data/synergies.json', root), JSON.stringify(out, null, 1) + '\n')
console.log(`Wrote ${count} references from ${Object.keys(out).length} units to src/data/synergies.json`)
