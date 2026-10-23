// General colors and symbols.
//
// Colors follow the army card colors. Symbols are white images in src/assets/generals/,
// named after the slug (e.g. jandar.svg); generals without one get their initial.
// Light colors are marked so their badge uses a dark symbol for contrast.

export interface GeneralStyle {
  slug: string
  /** Badge color. */
  color: string
  light: boolean
  /** Pool row color; defaults to the badge color. */
  rowColor: string
  /** How strongly the row is tinted, in percent. Pale colors need more. */
  rowTint: number
  /** Color of the stripe at the row's edge; defaults to the row color. */
  stripe: string
}

const GENERALS: Record<string, string> = {
  Jandar: '#2f6fd0', // blue
  Utgar: '#c8322f', // red
  Ullar: '#2f9a46', // green
  Vydar: '#8a8f99', // gray
  Einar: '#8248c2', // purple
  Aquilla: '#d9a514', // gold
  Valkrill: '#9a6435', // rusty bronze
  Revna: '#d8cba8', // bone
  Volarak: '#8cc63f', // lime green
  Marvel: '#b02a52',
  'G.I. Joe': '#5b7a32',
  Cobra: '#2b3f8f',
}

// Row colors that differ from the badge color.
const ROW_COLORS: Record<string, { color?: string; tint?: number; stripe?: string }> = {
  Vydar: { color: '#7f9fd2', tint: 30 }, // light steel blue
  Jandar: { stripe: '#ffffff' }, // blue row, white stripe
  Einar: { color: '#e2bd25', tint: 24 }, // yellow
  Aquilla: { color: '#1c2f5e', tint: 32 }, // dark navy
}

const LIGHT_GENERALS = new Set(['Revna', 'Volarak'])

const NEUTRAL = '#7a7266'

export function slugOf(general: string): string {
  return general.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function generalStyle(general: string): GeneralStyle {
  const color = GENERALS[general] ?? NEUTRAL
  const row = ROW_COLORS[general]
  return {
    slug: slugOf(general),
    color,
    light: LIGHT_GENERALS.has(general),
    rowColor: row?.color ?? color,
    rowTint: row?.tint ?? 13,
    stripe: row?.stripe ?? row?.color ?? color,
  }
}

const symbolFiles = import.meta.glob<string>('../assets/generals/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const generalSymbols: Record<string, string> = Object.fromEntries(
  Object.entries(symbolFiles).map(([path, url]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), url]),
)
