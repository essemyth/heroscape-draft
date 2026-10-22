import { unitIndex } from '../lib/data'
import { armyOf, costOf, figuresOf, pointsOf } from '../lib/draft'
import type { DraftState, Player } from '../lib/types'

interface Props {
  state: DraftState
  player: Player
  isTurn: boolean
  isMe?: boolean
}

export function ArmyPanel({ state, player, isTurn, isMe }: Props) {
  const { format, pointsTotal } = state.settings
  const army = armyOf(state, player.id, unitIndex)
  const points = pointsOf(army, format)
  const done = state.donePlayers.includes(player.id)
  const pct = Math.min(100, (points / pointsTotal) * 100)

  return (
    <section className={`panel army ${isTurn ? 'turn' : ''} ${isMe ? 'me' : ''}`}>
      <header className="army-header">
        <h3>
          {player.name}
          {isMe && <span className="muted"> (you)</span>}
        </h3>
        {isTurn && <span className="badge turn-badge">Picking</span>}
        {done && <span className="badge">Done</span>}
      </header>
      <div className="points-bar" role="meter" aria-valuemin={0} aria-valuemax={pointsTotal} aria-valuenow={points}>
        <div className="points-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="army-totals muted">
        <span>
          <strong>{points}</strong> / {pointsTotal} pts
        </span>
        <span>{figuresOf(army)} figures</span>
      </div>
      {army.length > 0 && (
        <ul className="army-list">
          {army.map((u, i) => (
            <li key={`${u.id}-${i}`}>
              <span>{u.name}</span>
              <span className="muted">{costOf(u, format)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
