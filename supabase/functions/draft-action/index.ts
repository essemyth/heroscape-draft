// Validates and applies every draft action. Clients can read drafts but never write
// draft state directly; this function checks the caller, the version they acted on,
// and the shared draft rules before saving.
//
// POST { draftId, version, action: DraftAction, link? }

import { createClient } from 'npm:@supabase/supabase-js@2'
import unitData from '../_shared/units.json' with { type: 'json' }
import { collections } from '../_shared/collections.ts'
import {
  DraftError,
  buildPool,
  currentPlayer,
  makePick,
  passDraft,
  roundOfSlot,
  startDraft,
  timeLeft,
  timeoutPick,
  undoLast,
  type UnitIndex,
} from '../_shared/draft.ts'
import type { DraftAction, DraftSettings, DraftState, LobbySettings, Unit } from '../_shared/types.ts'

const units: UnitIndex = new Map((unitData.units as Unit[]).map((u) => [u.id, u]))

// Allow the timer to fire this much early, to absorb clock differences between clients and server.
const TIMEOUT_GRACE_MS = 1500

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

interface PlayerRow {
  user_id: string
  name: string
  discord_id: string | null
  joined_at: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })

  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '')
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  const userId = auth.user?.id
  if (!userId) return reply(401, { error: 'Not signed in' })

  let body: { draftId: string; version: number; action: DraftAction; link?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { error: 'Invalid JSON' })
  }

  const { data: draft } = await admin.from('drafts').select('*').eq('id', body.draftId).maybeSingle()
  if (!draft) return reply(404, { error: 'Draft not found' })
  if (draft.version !== body.version) return reply(409, { error: 'The draft changed; try again' })

  const { data: playerRows } = await admin
    .from('draft_players')
    .select('user_id, name, discord_id, joined_at')
    .eq('draft_id', draft.id)
    .order('joined_at')
  const players = (playerRows ?? []) as PlayerRow[]

  const isHost = draft.host_id === userId
  const now = Date.now()
  const before = draft.state as DraftState | null
  let state: DraftState

  try {
    const action = body.action
    if (action.type === 'start') {
      if (!isHost) throw new DraftError('Only the host can start the draft')
      if (draft.status !== 'lobby') throw new DraftError('The draft has already started')
      state = startNewDraft(draft.settings as LobbySettings, players, now)
    } else {
      if (!before || draft.status !== 'drafting') throw new DraftError('The draft is not running')
      switch (action.type) {
        case 'pick':
          state = makePick(before, userId, action.unitId, units, now)
          break
        case 'pass':
          state = passDraft(before, userId, units, now)
          break
        case 'timeout':
          if (timeLeft(before, now + TIMEOUT_GRACE_MS) !== 0) throw new DraftError('Time is not up yet')
          state = timeoutPick(before, units, now)
          break
        case 'undo':
          if (!isHost) throw new DraftError('Only the host can undo')
          if (before.picks.length === 0) throw new DraftError('Nothing to undo')
          state = undoLast(before, units, now)
          break
        case 'end':
          if (!isHost) throw new DraftError('Only the host can end the draft')
          state = { ...before, status: 'complete' }
          break
        default:
          throw new DraftError('Unknown action')
      }
    }
  } catch (e) {
    if (e instanceof DraftError) return reply(400, { error: e.message })
    throw e
  }

  // Only save if nobody else changed the draft since we read it.
  const { data: saved } = await admin
    .from('drafts')
    .update({ state, status: state.status, version: draft.version + 1 })
    .eq('id', draft.id)
    .eq('version', draft.version)
    .select('version')
    .maybeSingle()
  if (!saved) return reply(409, { error: 'The draft changed; try again' })

  await notifyDiscord(draft.id, before, state, players, body.link)
  return reply(200, { ok: true, version: saved.version })
})

function startNewDraft(lobby: LobbySettings, players: PlayerRow[], now: number): DraftState {
  if (players.length < 2) throw new DraftError('Need at least 2 players')
  const collection = collections[lobby.collectionId]
  if (!collection) throw new DraftError('Unknown collection')

  const rank = (id: string) => {
    const i = lobby.playerOrder.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  const ordered = [...players].sort((a, b) => rank(a.user_id) - rank(b.user_id))

  const settings: DraftSettings = {
    format: lobby.format,
    pointsTotal: lobby.pointsTotal,
    groups: lobby.groups,
    timerSeconds: lobby.timerSeconds,
    collectionId: lobby.collectionId,
    players: ordered.map((p) => ({ id: p.user_id, name: p.name.trim() })),
  }
  if (!(settings.pointsTotal > 0)) throw new DraftError('Set a points total')
  const pool = buildPool(collection, units, settings)
  if (Object.keys(pool).length === 0) throw new DraftError('The pool is empty')
  return startDraft(settings, pool, units, now)
}

/** Pings the draft's Discord webhook when the turn moves to someone new or the draft ends. */
async function notifyDiscord(draftId: string, before: DraftState | null, after: DraftState, players: PlayerRow[], link?: string) {
  const prev = before ? currentPlayer(before) : null
  const next = currentPlayer(after)
  const finished = after.status === 'complete' && before?.status !== 'complete'
  if (!finished && (!next || next.id === prev?.id)) return

  const { data: secret } = await admin.from('draft_secrets').select('discord_webhook').eq('draft_id', draftId).maybeSingle()
  const webhook = secret?.discord_webhook
  if (!webhook) return

  const suffix = link ? `\n${link}` : ''
  let content: string
  if (finished) {
    content = `🏁 The draft is complete!${suffix}`
  } else {
    const row = players.find((p) => p.user_id === next!.id)
    const who = row?.discord_id ? `<@${row.discord_id}>` : `**${next!.name}**`
    const last = after.picks.at(-1)
    const lastText = last?.kind === 'pick' && last.unitId ? ` (${players.find((p) => p.user_id === last.playerId)?.name} took ${units.get(last.unitId)?.name})` : ''
    content = `⚔ ${who}, you're up! Round ${roundOfSlot(after.settings.players, after.slot)}${lastText}${suffix}`
  }

  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: ['users'] } }),
    })
  } catch (e) {
    console.error('Discord webhook failed', e)
  }
}
