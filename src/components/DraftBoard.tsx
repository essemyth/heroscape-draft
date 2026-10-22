import { useEffect, useRef, useState } from 'react'
import { unitIndex } from '../lib/data'
import { armyText, currentPlayer, roundOfSlot, timeLeft } from '../lib/draft'
import { FORMAT_LABELS, type DraftAction, type DraftState } from '../lib/types'
import { ArmyPanel } from './ArmyPanel'
import { Pool } from './Pool'

interface Props {
  state: DraftState
  me: string
  isHost: boolean
  onAction: (action: DraftAction, opts?: { quiet?: boolean }) => Promise<void>
  onHome: () => void
}

export function DraftBoard({ state, me, isHost, onAction, onHome }: Props) {
  const { settings } = state
  const player = currentPlayer(state)
  const myTurn = player?.id === me
  const amPlaying = settings.players.some((p) => p.id === me)
  const now = useNow(settings.timerSeconds !== null && state.status === 'drafting')
  const secondsLeft = timeLeft(state, now)
  const [busy, setBusy] = useState(false)

  const act = async (action: DraftAction) => {
    setBusy(true)
    await onAction(action)
    setBusy(false)
  }

  // Any open client may report an expired timer; the server checks the time and ignores duplicates.
  // Keep retrying while expired in case this clock runs a little ahead of the server's.
  const timedOut = secondsLeft === 0
  useEffect(() => {
    if (!timedOut) return
    const fire = () => onAction({ type: 'timeout' }, { quiet: true })
    fire()
    const id = setInterval(fire, 3000)
    return () => clearInterval(id)
  }, [timedOut, onAction])

  useTurnAlert(myTurn, player?.name ?? null)

  // Players in the order they pick next, so whoever is up sits at the top; then me first if not.
  const players = settings.players
  const start = player ? players.indexOf(player) : Math.max(0, players.findIndex((p) => p.id === me))
  const order = [...players.slice(start), ...players.slice(0, start)]

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
      <header className={`turn-banner ${myTurn ? 'mine' : player ? 'active' : 'complete'}`}>
        <div className="turn-main">
          {player ? (
            <>
              <span className="turn-label">Round {roundOfSlot(players, state.slot)}</span>
              <h1>{myTurn ? 'Your pick!' : `Waiting on ${player.name}…`}</h1>
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
          {myTurn && (
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm('Finish drafting? Your army will be final.') && act({ type: 'pass' })}
            >
              I'm done drafting
            </button>
          )}
          {isHost && player && (
            <button type="button" disabled={busy || state.picks.length === 0} onClick={() => window.confirm('Undo the last pick?') && act({ type: 'undo' })}>
              Undo last
            </button>
          )}
          {!player && (
            <button type="button" onClick={copyArmies}>
              {copied ? 'Copied!' : 'Copy armies'}
            </button>
          )}
          <NotifyButton />
          <button type="button" onClick={onHome}>
            Home
          </button>
        </div>
      </header>

      <div className="board-grid">
        <Pool
          state={state}
          playerId={amPlaying ? me : (player?.id ?? null)}
          canPick={myTurn && !busy}
          onPick={(unitId) => act({ type: 'pick', unitId })}
        />
        <aside className="sidebar">
          {order.map((p) => (
            <ArmyPanel key={p.id} state={state} player={p} isTurn={p.id === player?.id} isMe={p.id === me} />
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

/** Sound, tab title and (if allowed) a system notification when it becomes my turn. */
function useTurnAlert(myTurn: boolean, currentName: string | null) {
  const wasMyTurn = useRef(myTurn)
  useEffect(() => {
    document.title = myTurn ? '⚔ Your pick! · HeroScape Draft' : currentName ? `${currentName}'s pick · HeroScape Draft` : 'Draft complete · HeroScape Draft'
    if (myTurn && !wasMyTurn.current) {
      chime()
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Your pick!', { body: "It's your turn in the HeroScape draft.", tag: 'heroscape-draft-turn' })
      }
    }
    wasMyTurn.current = myTurn
  }, [myTurn, currentName])

  // Flash the tab title while it's my turn and the tab is in the background.
  useEffect(() => {
    if (!myTurn) return
    let on = false
    const id = setInterval(() => {
      if (!document.hidden) return
      on = !on
      document.title = on ? '⚔ YOUR PICK ⚔' : '⚔ Your pick! · HeroScape Draft'
    }, 1000)
    return () => clearInterval(id)
  }, [myTurn])
}

function chime() {
  try {
    const ctx = new AudioContext()
    const notes = [660, 880]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'triangle'
      const t = ctx.currentTime + i * 0.18
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    })
    setTimeout(() => ctx.close(), 1000)
  } catch {
    // Audio blocked until the user interacts with the page; the banner still shows.
  }
}

function NotifyButton() {
  const supported = 'Notification' in window
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied')
  if (!supported || permission !== 'default') return null
  return (
    <button type="button" onClick={async () => setPermission(await Notification.requestPermission())} title="Get a notification when it's your pick">
      Enable notifications
    </button>
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
