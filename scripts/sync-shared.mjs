// Copies the draft rules and data the edge function needs into supabase/functions/_shared.
// The browser app is the source of truth; run this (or `npm run deploy:functions`) after changing them.

import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const out = new URL('supabase/functions/_shared/', root)

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
for (const file of ['src/lib/draft.ts', 'src/lib/types.ts', 'src/data/units.json']) {
  await cp(new URL(file, root), new URL(file.split('/').pop(), out))
}
await cp(new URL('src/data/collections/', root), new URL('collections/', out), { recursive: true })

// Static imports so the edge function bundler includes every collection.
const names = (await readdir(new URL('collections/', out))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
const lines = names.map((n, i) => `import c${i} from './collections/${n}.json' with { type: 'json' }`)
lines.push('', 'export const collections: Record<string, Record<string, number>> = {')
for (const [i, n] of names.entries()) lines.push(`  ${JSON.stringify(n)}: c${i}.units,`)
lines.push('}', '')
await writeFile(new URL('collections.ts', out), lines.join('\n'))

console.log('Synced shared rules and data to supabase/functions/_shared')
