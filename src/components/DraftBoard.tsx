import { useEffect, useState } from 'react'
import { unitIndex } from '../lib/data'
import { armyText, currentPlayer, roundOfSlot, timeLeft } from '../lib/draft'
import { FORMAT_LABELS, type DraftState } from '../lib/types'
import { ArmyPanel } from './ArmyPanel'
import { Pool } from './Pool'

interface Props {
  state: DraftState
  onPick: (unitId: string) => void
  onPass: () => void
  onTimeout: () => void
  onUndo: () => void
  onNewDraft: () => void
}

export function DraftBoard({ state, onPick, onPass, onTimeout, onUndo, onNewDraft }: Props) {
  const { settings } = state
  const player = currentPlayer(state)
  const now = useNow(settings.timerSeconds !== null && state.status === 'drafting')
  const secondsLeft = timeLeft(state, now)

  useEffect(() => {
    if (secondsLeft === 0) onTimeout()
  }, [secondsLeft, onTimeout])

  useEffect(() => {
    document.title = player ? `⚔ ${player.name}'s pick · HeroScape Draft` : 'Draft complete · HeroScape Draft'
  }, [player])

  // Players in the order they pick next, so whoever is up sits at the top.
  const players = settings.players
  const order = player ? [...players.slice(players.indexOf(player)), ...players.slice(0, players.indexOf(player))] : players

  const [copied, setCopied] = useState(false)
  const copyArmies = async () => {
    const text = [summary(state), ...players.map((p) => armyText(state, p, unitIndex))].join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the armies:', text)
    }
  }

  return (
    <div className="board">
      <header className={`turn-banner ${player ? 'active' : 'complete'}`}>
        <div className="turn-main">
          {player ? (
            <>
              <span className="turn-label">Round {roundOfSlot(players, state.slot)}</span>
              <h1>{player.name}'s pick</h1>
            </>
          ) : (
            <h1>Draft complete</h1>
          )}
          <span className="muted">{summary(state)}</span>
        </div>
        {secondsLeft !== null && (
          <div className={`timer ${secondsLeft <= 10 ? 'urgent' : ''}`} aria-live="polite">
            {formatTime(secondsLeft)}
          </div>
        )}
        <div className="button-row">
          {player && (
            <button type="button" onClick={onPass} title="Stop drafting; your army is final">
              {player.name} is done
            </button>
          )}
          <button type="button" disabled={state.picks.length === 0} onClick={onUndo}>
            Undo last
          </button>
          {!player && (
            <button type="button" onClick={copyArmies}>
              {copied ? 'Copied!' : 'Copy armies'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (!player || window.confirm('Abandon this draft and start a new one?')) onNewDraft()
            }}
          >
            New draft
          </button>
        </div>
      </header>

      <div className="board-grid">
        <Pool state={state} playerId={player?.id ?? null} canPick={!!player} onPick={onPick} />
        <aside className="sidebar">
          {order.map((p) => (
            <ArmyPanel key={p.id} state={state} player={p} isTurn={p.id === player?.id} />
          ))}
          <PickLog state={state} />
        </aside>
      </div>
    </div>
  )
}

function PickLog({ state }: { state: DraftState }) {
  if (state.picks.length === 0) return null
  const names = new Map(state.settings.players.map((p) => [p.id, p.name]))
  return (
    <section className="panel">
      <h3>Pick log</h3>
      <ol className="pick-log" reversed>
        {[...state.picks].reverse().map((p, i) => (
          <li key={i}>
            <strong>{names.get(p.playerId)}</strong>{' '}
            {p.kind === 'pick' ? unitIndex.get(p.unitId!)!.name : p.kind === 'pass' ? 'finished drafting' : 'ran out of time'}
          </li>
        ))}
      </ol>
    </section>
  )
}

function summary(state: DraftState): string {
  const { format, pointsTotal, timerSeconds } = state.settings
  const timer = timerSeconds ? ` · ${formatTime(timerSeconds)} per pick` : ''
  return `${FORMAT_LABELS[format]} · ${pointsTotal} points${timer}`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Current time, re-rendering every half second while enabled. */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [enabled])
  return now
}
