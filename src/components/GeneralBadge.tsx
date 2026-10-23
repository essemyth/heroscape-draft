import type { CSSProperties } from 'react'
import { generalStyle, generalSymbols } from '../lib/generals'

export function GeneralBadge({ general, size = 28 }: { general: string; size?: number }) {
  const { slug, color, light } = generalStyle(general)
  const symbol = generalSymbols[slug]
  const style = { '--general': color, width: size, height: size, fontSize: size * 0.5 } as CSSProperties
  return (
    <span className={`general-badge ${light ? 'light' : ''}`} style={style} title={general} aria-label={general} role="img">
      {symbol ? <img src={symbol} alt="" /> : general.charAt(0)}
    </span>
  )
}
