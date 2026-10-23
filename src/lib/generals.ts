// General colors and symbols.
//
// Colors follow the army card colors. Symbols are white images in src/assets/generals/,
// named after the slug (e.g. jandar.svg); generals without one get their initial.
// Light colors are marked so their badge uses a dark symbol for contrast.

export interface GeneralStyle {
  slug: string
  color: string
  light: boolean
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

const LIGHT_GENERALS = new Set(['Revna', 'Volarak'])

const NEUTRAL = '#7a7266'

export function slugOf(general: string): string {
  return general.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function generalStyle(general: string): GeneralStyle {
  return { slug: slugOf(general), color: GENERALS[general] ?? NEUTRAL, light: LIGHT_GENERALS.has(general) }
}

const symbolFiles = import.meta.glob<string>('../assets/generals/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const generalSymbols: Record<string, string> = Object.fromEntries(
  Object.entries(symbolFiles).map(([path, url]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), url]),
)
