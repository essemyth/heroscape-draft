// Builds the site icon from the Jandar general badge (same look as the badge on Jandar unit rows):
// public/favicon.svg plus PNGs for phone home screens. Run: node scripts/make-icons.mjs

import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const root = new URL('../', import.meta.url)
const BLUE = '#2f6fd0' // Jandar's badge color (src/lib/generals.ts)

const symbol = await readFile(new URL('src/assets/generals/jandar.svg', root), 'utf8')
const viewBox = symbol.match(/viewBox="([^"]+)"/)[1]
const inner = symbol.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
const [, , w, h] = viewBox.split(/\s+/).map(Number)

// The badge shows the symbol at 68% of the circle; keep its aspect ratio and center it.
const size = 64
const box = size * 0.68
const scale = Math.min(box / w, box / h)
const sw = w * scale
const sh = h * scale

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0.8" stdDeviation="0.8" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <circle cx="32" cy="32" r="30.5" fill="${BLUE}" stroke="#1f4f9c" stroke-width="3"/>
  <svg x="${((size - sw) / 2).toFixed(2)}" y="${((size - sh) / 2).toFixed(2)}" width="${sw.toFixed(2)}" height="${sh.toFixed(2)}" viewBox="${viewBox}" filter="url(#shadow)">${inner}</svg>
</svg>
`

await writeFile(new URL('public/favicon.svg', root), svg)
for (const [name, px] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  await sharp(Buffer.from(svg), { density: (72 * px) / size }).resize(px, px).png().toFile(new URL(`public/${name}`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
}
console.log('Wrote public/favicon.svg, apple-touch-icon.png, icon-192.png, icon-512.png')
