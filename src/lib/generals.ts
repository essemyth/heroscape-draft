// General colors and symbols.
//
// Colors follow the army card colors. To use the real general symbols, drop image files
// named after the slug into src/assets/generals/ (e.g. jandar.svg, utgar.png); until then
// a colored badge with the general's initial is shown.

export interface GeneralStyle {
  slug: string
  color: string
}

const GENERALS: Record<string, string> = {
  Jandar: '#2f6fd0', // blue
  Utgar: '#c8322f', // red
  Ullar: '#2f9a46', // green
  Vydar: '#8a8f99', // gray
  Einar: '#8248c2', // purple
  Aquilla: '#d9a514', // gold
  Valkrill: '#9a6435', // rusty bronze
  Revna: '#6b7a2a', // olive, like Valkrill's cards (unconfirmed)
  Volarak: '#e0711b', // orange (unconfirmed)
  Marvel: '#b02a52',
  'G.I. Joe': '#5b7a32',
  Cobra: '#2b3f8f',
}

const NEUTRAL = '#7a7266'

export function slugOf(general: string): string {
  return general.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function generalStyle(general: string): GeneralStyle {
  return { slug: slugOf(general), color: GENERALS[general] ?? NEUTRAL }
}

const symbolFiles = import.meta.glob<string>('../assets/generals/*.{svg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

export const generalSymbols: Record<string, string> = Object.fromEntries(
  Object.entries(symbolFiles).map(([path, url]) => [path.split('/').pop()!.replace(/\.\w+$/, ''), url]),
)
