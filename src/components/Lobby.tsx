import { useEffect, useMemo, useState } from 'react'
import { ALL_GROUPS, collections, unitIndex } from '../lib/data'
import { buildPool, costOf } from '../lib/draft'
import type { DraftRow, PlayerRow } from '../lib/online'
import { saveName, savedName } from '../lib/online'
import { supabase } from '../lib/supabase'
import { FORMAT_LABELS, type DraftSettings, type Format, type LobbySettings } from '../lib/types'

const CUSTOM_GROUPS = ['C3V', 'SoV']
const POINT_PRESETS = [300, 400, 500, 550, 600]
const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No timer', value: null },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '90 seconds', value: 90 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
]

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Joined players in pick order: host's chosen order first, then anyone not yet placed, by join time. */
function orderedPlayers(settings: LobbySettings, players: PlayerRow[]): PlayerRow[] {
  const rank = (id: string) => {
    const i = settings.playerOrder.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...players].sort((a, b) => rank(a.user_id) - rank(b.user_id) || a.joined_at.localeCompare(b.joined_at))
}

interface Props {
  draft: DraftRow
  players: PlayerRow[]
  me: string
  onStart: () => Promise<void>
  onError: (message: string) => void
}

export function Lobby({ draft, players, me, onStart, onError }: Props) {
  const isHost = draft.host_id === me
  const settings = draft.settings
  const seated = orderedPlayers(settings, players)
  const mine = players.find((p) => p.user_id === me)

  const update = async (patch: Partial<LobbySettings>) => {
    const { error } = await supabase.from('drafts').update({ settings: { ...settings, ...patch } }).eq('id', draft.id)
    if (error) onError(error.message)
  }

  const collection = collections[settings.collectionId] ?? {}
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const [id, qty] of Object.entries(collections[settings.collectionId] ?? {})) {
      const g = unitIndex.get(id)?.group
      if (g) counts[g] = (counts[g] ?? 0) + qty
    }
    return counts
  }, [settings.collectionId])

  const poolSettings: DraftSettings = { ...settings, players: [] }
  const pool = buildPool(collection, unitIndex, poolSettings)
  const poolCards = Object.values(pool).reduce((a, b) => a + b, 0)
  const poolPoints = Object.entries(pool).reduce((sum, [id, qty]) => sum + (costOf(unitIndex.get(id)!, settings.format) ?? 0) * qty, 0)

  // Delta VC prices only matter once Valhalla Customs units are in the pool.
  const customsOn = settings.groups.some((g) => CUSTOM_GROUPS.includes(g))
  const formats = (Object.keys(FORMAT_LABELS) as Format[]).filter((f) => f !== 'deltaVc' || customsOn || settings.format === 'deltaVc')

  const toggleGroup = (g: string) =>
    update({ groups: settings.groups.includes(g) ? settings.groups.filter((x) => x !== g) : [...settings.groups, g] })
  const setOrder = (ids: string[]) => update({ playerOrder: ids })
  const movePlayer = (index: number, delta: number) => {
    const ids = seated.map((p) => p.user_id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + delta, 0, id)
    setOrder(ids)
  }
  const kick = async (userId: string) => {
    const { error } = await supabase.from('draft_players').delete().eq('draft_id', draft.id).eq('user_id', userId)
    if (error) onError(error.message)
  }

  const [starting, setStarting] = useState(false)
  const canStart = isHost && seated.length >= 2 && settings.pointsTotal > 0 && poolCards > 0

  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the invite link:', window.location.href)
    }
  }

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>Draft lobby</h1>
        <p className="muted">
          {isHost ? 'Share the invite link, set up the draft, then start it. Settings lock once it starts.' : 'Waiting for the host to start the draft.'}
        </p>
        <div className="button-row invite">
          <input readOnly value={window.location.href} aria-label="Invite link" onFocus={(e) => e.target.select()} />
          <button type="button" onClick={copyLink}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
      </header>

      {mine ? (
        <YourSeat draft={draft} player={mine} onError={onError} />
      ) : (
        <JoinForm draftId={draft.id} onError={onError} />
      )}

      <section className="panel">
        <h2>Format</h2>
        <fieldset disabled={!isHost} className="plain">
          <div className="field-row">
            <label className="field">
              <span>Pricing</span>
              <select value={settings.format} onChange={(e) => update({ format: e.target.value as Format })}>
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Pick timer</span>
              <select
                value={settings.timerSeconds ?? ''}
                onChange={(e) => update({ timerSeconds: e.target.value === '' ? null : Number(e.target.value) })}
              >
                {TIMER_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ''}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <span>Army points</span>
            <div className="chip-row">
              {POINT_PRESETS.map((p) => (
                <button key={p} type="button" className={`chip ${settings.pointsTotal === p ? 'on' : ''}`} onClick={() => update({ pointsTotal: p })}>
                  {p}
                </button>
              ))}
              <PointsInput key={settings.pointsTotal} value={settings.pointsTotal} onCommit={(pointsTotal) => update({ pointsTotal })} />
            </div>
          </div>
        </fieldset>
      </section>

      <section className="panel">
        <h2>Pool</h2>
        <fieldset disabled={!isHost} className="plain">
          {Object.keys(collections).length > 1 && (
            <label className="field">
              <span>Collection</span>
              <select value={settings.collectionId} onChange={(e) => update({ collectionId: e.target.value })}>
                {Object.keys(collections).map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span>Unit groups</span>
            <div className="chip-row">
              {ALL_GROUPS.map((g) => (
                <button key={g} type="button" className={`chip ${settings.groups.includes(g) ? 'on' : ''}`} onClick={() => toggleGroup(g)}>
                  {g}
                  <span className="chip-count">{groupCounts[g] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </fieldset>
        <p className="muted">
          {settings.collectionId}'s pool: <strong>{Object.keys(pool).length}</strong> units, <strong>{poolCards}</strong> cards,{' '}
          <strong>{poolPoints.toLocaleString()}</strong> points
        </p>
      </section>

      <section className="panel">
        <h2>Players</h2>
        <p className="muted">Snake order: first pick goes top to bottom, then back up.</p>
        <ol className="player-list">
          {seated.map((p, i) => (
            <li key={p.user_id}>
              <span className="seat">{i + 1}</span>
              <span className="player-name">
                {p.name}
                {p.user_id === draft.host_id && <span className="badge">Host</span>}
                {p.user_id === me && <span className="badge">You</span>}
                {p.discord_id && <span className="badge" title="Gets Discord pings">Discord</span>}
              </span>
              {isHost && (
                <>
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => movePlayer(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={i === seated.length - 1}
                    onClick={() => movePlayer(i, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={p.user_id === me}
                    onClick={() => kick(p.user_id)}
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
        {isHost && (
          <div className="button-row">
            <button type="button" onClick={() => setOrder(shuffle(seated.map((p) => p.user_id)))}>
              Randomize order
            </button>
          </div>
        )}
      </section>

      {isHost && <DiscordWebhook draftId={draft.id} onError={onError} />}

      {isHost && (
        <button
          type="button"
          className="primary start-btn"
          disabled={!canStart || starting}
          onClick={async () => {
            setStarting(true)
            await onStart()
            setStarting(false)
          }}
        >
          {seated.length < 2 ? 'Waiting for players…' : starting ? 'Starting…' : 'Start draft'}
        </button>
      )}
    </div>
  )
}

/**
 * Number input that saves on blur or Enter, so typing "550" doesn't save 5 and 55 along the way.
 * Render with key={value} so it resets when the saved value changes.
 */
function PointsInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const commit = () => {
    const n = Math.max(0, Math.round(Number(text)))
    if (Number.isFinite(n) && n !== value) onCommit(n)
    else setText(String(value))
  }
  return (
    <input
      className="points-input"
      type="number"
      min={10}
      step={10}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      aria-label="Custom points total"
    />
  )
}

function JoinForm({ draftId, onError }: { draftId: string; onError: (m: string) => void }) {
  const [name, setName] = useState(savedName)
  const [busy, setBusy] = useState(false)
  const join = async () => {
    setBusy(true)
    const { error } = await supabase.from('draft_players').insert({ draft_id: draftId, name: name.trim() })
    setBusy(false)
    if (error) onError(error.code === '23505' ? 'You already joined' : error.message)
    else saveName(name.trim())
  }
  return (
    <section className="panel join">
      <h2>Join this draft</h2>
      <div className="button-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={40} onKeyDown={(e) => e.key === 'Enter' && name.trim() && join()} />
        <button type="button" className="primary" disabled={!name.trim() || busy} onClick={join}>
          Join
        </button>
      </div>
    </section>
  )
}

function YourSeat({ draft, player, onError }: { draft: DraftRow; player: PlayerRow; onError: (m: string) => void }) {
  const [name, setName] = useState(player.name)
  const [discordId, setDiscordId] = useState(player.discord_id ?? '')
  const dirty = name.trim() !== player.name || (discordId.trim() || null) !== player.discord_id
  const validDiscord = discordId.trim() === '' || /^[0-9]{5,25}$/.test(discordId.trim())

  const save = async () => {
    const { error } = await supabase
      .from('draft_players')
      .update({ name: name.trim(), discord_id: discordId.trim() || null })
      .eq('draft_id', draft.id)
      .eq('user_id', player.user_id)
    if (error) onError(error.message)
    else saveName(name.trim())
  }
  const leave = async () => {
    const { error } = await supabase.from('draft_players').delete().eq('draft_id', draft.id).eq('user_id', player.user_id)
    if (error) onError(error.message)
  }

  return (
    <section className="panel">
      <h2>You</h2>
      <div className="field-row">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </label>
        <label className="field">
          <span>Discord user ID (optional, for turn pings)</span>
          <input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="e.g. 123456789012345678" inputMode="numeric" />
        </label>
      </div>
      <details className="muted help">
        <summary>How do I find my Discord user ID?</summary>
        In Discord, open Settings → Advanced and turn on Developer Mode. Then right-click your own name and choose “Copy User
        ID”.
      </details>
      {!validDiscord && <p className="warn">A Discord user ID is just digits.</p>}
      <div className="button-row">
        <button type="button" className="primary" disabled={!dirty || !name.trim() || !validDiscord} onClick={save}>
          Save
        </button>
        {player.user_id !== draft.host_id && (
          <button type="button" onClick={leave}>
            Leave draft
          </button>
        )}
      </div>
    </section>
  )
}

function DiscordWebhook({ draftId, onError }: { draftId: string; onError: (m: string) => void }) {
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => {
    supabase
      .from('draft_secrets')
      .select('discord_webhook')
      .eq('draft_id', draftId)
      .maybeSingle()
      .then(({ data }) => {
        setUrl(data?.discord_webhook ?? '')
        setSaved(data?.discord_webhook ?? '')
      })
  }, [draftId])

  const valid = url.trim() === '' || /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url.trim())
  const save = async () => {
    const { error } = await supabase.from('draft_secrets').upsert({ draft_id: draftId, discord_webhook: url.trim() || null })
    if (error) onError(error.message)
    else setSaved(url.trim())
  }

  return (
    <section className="panel">
      <h2>Discord turn alerts</h2>
      <p className="muted">
        Paste a webhook for your group's channel (Channel settings → Integrations → Webhooks → New Webhook → Copy URL). Only you can
        see it.
      </p>
      <div className="button-row">
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" />
        <button type="button" disabled={!valid || url.trim() === saved} onClick={save}>
          Save
        </button>
      </div>
      {!valid && <p className="warn">That doesn't look like a Discord webhook URL.</p>}
    </section>
  )
}
