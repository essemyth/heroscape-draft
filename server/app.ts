// The HeroScape Draft server: JSON API, live updates, photo files, and the built site.
// Every permission the Supabase version enforced with row-level security is checked here.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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
} from '../src/lib/draft.ts'
import type { DraftAction, DraftSettings, DraftState, LobbySettings, Unit } from '../src/lib/types.ts'
import { openDb, transaction, type Db } from './db.ts'
import { publish, subscribe } from './events.ts'
import { HttpError, badRequest, forbidden, isHttps, notFound, parseCookies, readJson, sendJson } from './http.ts'

export interface ServerOptions {
  /** Where the SQLite file and photos live (a persistent volume in production). */
  dataDir: string
  /** The built site (vite build output); omit to serve only the API. */
  siteDir?: string
  /** SHA-256 (hex) of the photo code. */
  photoCodeHash: string
  /** Project root, for unit and collection data. */
  rootDir: string
}

const SESSION_COOKIE = 'hsd_session'
// Allow the timer to fire this much early, to absorb clock differences between clients and server.
const TIMEOUT_GRACE_MS = 1500

interface DraftRowDb {
  id: string
  host_id: string
  status: 'lobby' | 'drafting' | 'complete'
  settings: string
  state: string | null
  version: number
  created_at: string
}

interface PlayerRow {
  draft_id: string
  user_id: string
  name: string
  discord_id: string | null
  joined_at: string
}

interface PhotoRow {
  unit_id: string
  path: string
  thumb_path: string
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const now = () => new Date().toISOString()

export function createApp(opts: ServerOptions): { server: Server; db: Db } {
  const db = openDb(opts.dataDir)
  const photoDir = join(opts.dataDir, 'photos')
  mkdirSync(photoDir, { recursive: true })

  // --- Game data ----------------------------------------------------------------------------
  const unitData = JSON.parse(readFileSync(join(opts.rootDir, 'src/data/units.json'), 'utf8')) as { units: Unit[] }
  const units: UnitIndex = new Map(unitData.units.map((u) => [u.id, u]))
  const collectionsDir = join(opts.rootDir, 'src/data/collections')
  const collections: Record<string, Record<string, number>> = Object.fromEntries(
    readdirSync(collectionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(collectionsDir, f), 'utf8')).units]),
  )

  // --- Rows ---------------------------------------------------------------------------------
  const draftOut = (row: DraftRowDb) => ({
    id: row.id,
    host_id: row.host_id,
    status: row.status,
    settings: JSON.parse(row.settings) as LobbySettings,
    state: row.state ? (JSON.parse(row.state) as DraftState) : null,
    version: row.version,
    created_at: row.created_at,
  })
  const getDraft = (id: string) => db.prepare('select * from drafts where id = ?').get(id) as DraftRowDb | undefined
  const requireDraft = (id: string) => {
    const row = getDraft(id)
    if (!row) throw notFound('Draft not found')
    return row
  }
  const getPlayers = (draftId: string) =>
    db.prepare('select * from draft_players where draft_id = ? order by joined_at').all(draftId) as unknown as PlayerRow[]

  const pushDraft = (id: string) => {
    const row = getDraft(id)
    if (row) publish(`draft:${id}`, 'draft', draftOut(row))
  }
  const pushPlayers = (id: string) => publish(`draft:${id}`, 'players', getPlayers(id))

  // --- Sessions -----------------------------------------------------------------------------
  /** The signed-in browser's user id; creates an anonymous user (and cookie) on first visit. */
  function session(req: IncomingMessage, res: ServerResponse, create: boolean): string | null {
    const token = parseCookies(req)[SESSION_COOKIE]
    if (token) {
      const row = db.prepare('select id from users where token_hash = ?').get(sha256(token)) as { id: string } | undefined
      if (row) return row.id
    }
    if (!create) return null
    const newToken = randomBytes(32).toString('base64url')
    const id = randomUUID()
    db.prepare('insert into users (id, token_hash, created_at) values (?, ?, ?)').run(id, sha256(newToken), now())
    const secure = isHttps(req) ? '; Secure' : ''
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=315360000${secure}`)
    return id
  }
  const requireUser = (req: IncomingMessage, res: ServerResponse) => {
    const id = session(req, res, false)
    if (!id) throw new HttpError(401, 'Not signed in')
    return id
  }
  const isEditor = (userId: string) => Boolean(db.prepare('select 1 from photo_editors where user_id = ?').get(userId))

  // --- Validation ---------------------------------------------------------------------------
  const cleanName = (name: unknown) => {
    const n = typeof name === 'string' ? name.trim() : ''
    if (n.length < 1 || n.length > 40) throw badRequest('Names must be 1–40 characters')
    return n
  }
  const cleanDiscordId = (v: unknown) => {
    if (v === null || v === undefined || v === '') return null
    if (typeof v !== 'string' || !/^[0-9]{5,25}$/.test(v)) throw badRequest('A Discord user ID is just digits')
    return v
  }
  const cleanSettings = (s: unknown): LobbySettings => {
    const v = s as LobbySettings
    if (!v || typeof v !== 'object') throw badRequest('Missing settings')
    if (!['normal', 'deltaClassic', 'deltaVc'].includes(v.format)) throw badRequest('Unknown pricing format')
    if (!Number.isFinite(v.pointsTotal) || v.pointsTotal < 0 || v.pointsTotal > 100000) throw badRequest('Invalid points total')
    if (!Array.isArray(v.groups) || !Array.isArray(v.playerOrder)) throw badRequest('Invalid settings')
    if (v.timerSeconds !== null && !(Number.isFinite(v.timerSeconds) && v.timerSeconds > 0)) throw badRequest('Invalid timer')
    if (!(v.collectionId in collections)) throw badRequest('Unknown collection')
    return {
      format: v.format,
      pointsTotal: Math.round(v.pointsTotal),
      groups: v.groups.filter((g) => typeof g === 'string'),
      timerSeconds: v.timerSeconds,
      collectionId: v.collectionId,
      playerOrder: v.playerOrder.filter((g) => typeof g === 'string'),
    }
  }
  const inLobby = (row: DraftRowDb) => {
    if (row.status !== 'lobby') throw forbidden('The draft has already started')
  }

  // --- Draft actions (ported from the draft-action edge function) ---------------------------
  function startNewDraft(lobby: LobbySettings, players: PlayerRow[], at: number): DraftState {
    if (players.length < 2) throw new DraftError('Need at least 2 players')
    const collection = collections[lobby.collectionId]
    if (!collection) throw new DraftError('Unknown collection')
    const rank = (id: string) => {
      const i = lobby.playerOrder.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const ordered = [...players].sort((a, b) => rank(a.user_id) - rank(b.user_id) || a.joined_at.localeCompare(b.joined_at))
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
    return startDraft(settings, pool, units, at)
  }

  function applyAction(row: DraftRowDb, userId: string, action: DraftAction, players: PlayerRow[]): DraftState {
    const isHost = row.host_id === userId
    const at = Date.now()
    const before = row.state ? (JSON.parse(row.state) as DraftState) : null
    if (action?.type === 'start') {
      if (!isHost) throw new DraftError('Only the host can start the draft')
      if (row.status !== 'lobby') throw new DraftError('The draft has already started')
      return startNewDraft(JSON.parse(row.settings), players, at)
    }
    if (!before || row.status !== 'drafting') throw new DraftError('The draft is not running')
    switch (action?.type) {
      case 'pick':
        return makePick(before, userId, action.unitId, units, at)
      case 'pass':
        return passDraft(before, userId, units, at)
      case 'timeout':
        if (timeLeft(before, at + TIMEOUT_GRACE_MS) !== 0) throw new DraftError('Time is not up yet')
        return timeoutPick(before, units, at)
      case 'undo':
        if (!isHost) throw new DraftError('Only the host can undo')
        if (before.picks.length === 0) throw new DraftError('Nothing to undo')
        return undoLast(before, units, at)
      case 'end':
        if (!isHost) throw new DraftError('Only the host can end the draft')
        return { ...before, status: 'complete' }
      default:
        throw new DraftError('Unknown action')
    }
  }

  /** Pings the draft's Discord webhook when the turn moves to someone new or the draft ends. */
  async function notifyDiscord(draftId: string, before: DraftState | null, after: DraftState, players: PlayerRow[], link?: string) {
    const prev = before ? currentPlayer(before) : null
    const next = currentPlayer(after)
    const finished = after.status === 'complete' && before?.status !== 'complete'
    if (!finished && (!next || next.id === prev?.id)) return
    const secret = db.prepare('select discord_webhook from draft_secrets where draft_id = ?').get(draftId) as { discord_webhook: string | null } | undefined
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

  // --- Photos -------------------------------------------------------------------------------
  const photoRows = () => db.prepare('select unit_id, path, thumb_path from unit_photos').all() as unknown as PhotoRow[]
  const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' }
  /** Writes a base64 image under photos/<unit>/ and returns its relative path. */
  function savePhoto(unitId: string, base64: unknown, type: unknown, suffix: string, stamp: number) {
    const ext = typeof type === 'string' ? EXT[type] : undefined
    if (!ext || typeof base64 !== 'string') throw badRequest('Photos must be WebP or JPEG')
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0 || bytes.length > 3 * 1024 * 1024) throw badRequest('That photo is too large')
    const path = `${unitId}/${stamp}${suffix}.${ext}`
    mkdirSync(join(photoDir, unitId), { recursive: true })
    writeFileSync(join(photoDir, path), bytes)
    return path
  }
  const removePhotoFile = (path: string) => {
    try {
      unlinkSync(join(photoDir, path))
    } catch {
      // Already gone.
    }
  }
  const requireEditor = (userId: string) => {
    if (!isEditor(userId)) throw forbidden('This device is not allowed to change photos')
  }
  const requireUnit = (unitId: string) => {
    if (!units.has(unitId)) throw notFound('Unknown unit')
  }

  // --- Routing ------------------------------------------------------------------------------
  type Handler = (req: IncomingMessage, res: ServerResponse, params: string[]) => Promise<void> | void
  const routes: [string, RegExp, Handler][] = []
  const route = (method: string, pattern: string, handler: Handler) =>
    routes.push([method, new RegExp(`^${pattern.replace(/:[a-z]+/gi, '([^/]+)')}$`), handler])

  route('GET', '/healthz', (_req, res) => sendJson(res, 200, { ok: true }))

  route('GET', '/api/session', (req, res) => sendJson(res, 200, { userId: session(req, res, true) }))

  route('POST', '/api/drafts', async (req, res) => {
    const userId = requireUser(req, res)
    const body = await readJson<{ hostName: unknown; settings: unknown }>(req)
    const name = cleanName(body.hostName)
    const settings = cleanSettings(body.settings)
    settings.playerOrder = [userId]
    const id = randomUUID()
    const at = now()
    transaction(db, () => {
      db.prepare('insert into drafts (id, host_id, status, settings, state, version, created_at, updated_at) values (?, ?, ?, ?, null, 0, ?, ?)').run(id, userId, 'lobby', JSON.stringify(settings), at, at)
      db.prepare('insert into draft_players (draft_id, user_id, name, discord_id, joined_at) values (?, ?, ?, null, ?)').run(id, userId, name, at)
    })
    sendJson(res, 201, { id })
  })

  route('GET', '/api/drafts/mine', (req, res) => {
    const userId = requireUser(req, res)
    const rows = db
      .prepare('select d.* from drafts d join draft_players p on p.draft_id = d.id where p.user_id = ? order by d.created_at desc')
      .all(userId) as unknown as DraftRowDb[]
    sendJson(res, 200, rows.map(draftOut).map(({ id, status, created_at, host_id, settings }) => ({ id, status, created_at, host_id, settings })))
  })

  route('GET', '/api/drafts/:id', (req, res, [id]) => {
    requireUser(req, res)
    sendJson(res, 200, { draft: draftOut(requireDraft(id)), players: getPlayers(id) })
  })

  route('GET', '/api/drafts/:id/events', (req, res, [id]) => {
    requireUser(req, res)
    requireDraft(id)
    subscribe(req, res, `draft:${id}`, () => {
      const row = getDraft(id)
      return row ? [['draft', draftOut(row)], ['players', getPlayers(id)]] : [['deleted', { id }]]
    })
  })

  route('DELETE', '/api/drafts/:id', (req, res, [id]) => {
    const userId = requireUser(req, res)
    const row = requireDraft(id)
    if (row.host_id !== userId) throw forbidden('Only the host can delete this draft')
    db.prepare('delete from drafts where id = ?').run(id)
    publish(`draft:${id}`, 'deleted', { id })
    sendJson(res, 200, { ok: true })
  })

  route('PATCH', '/api/drafts/:id/settings', async (req, res, [id]) => {
    const userId = requireUser(req, res)
    const row = requireDraft(id)
    if (row.host_id !== userId) throw forbidden('Only the host can change settings')
    inLobby(row)
    const { settings } = await readJson<{ settings: unknown }>(req)
    db.prepare('update drafts set settings = ?, updated_at = ? where id = ?').run(JSON.stringify(cleanSettings(settings)), now(), id)
    pushDraft(id)
    sendJson(res, 200, { ok: true })
  })

  route('POST', '/api/drafts/:id/players', async (req, res, [id]) => {
    const userId = requireUser(req, res)
    inLobby(requireDraft(id))
    const { name } = await readJson<{ name: unknown }>(req)
    const exists = db.prepare('select 1 from draft_players where draft_id = ? and user_id = ?').get(id, userId)
    if (exists) throw new HttpError(409, 'You already joined')
    db.prepare('insert into draft_players (draft_id, user_id, name, discord_id, joined_at) values (?, ?, ?, null, ?)').run(id, userId, cleanName(name), now())
    pushPlayers(id)
    sendJson(res, 201, { ok: true })
  })

  route('PATCH', '/api/drafts/:id/players/me', async (req, res, [id]) => {
    const userId = requireUser(req, res)
    inLobby(requireDraft(id))
    const body = await readJson<{ name: unknown; discord_id: unknown }>(req)
    const result = db
      .prepare('update draft_players set name = ?, discord_id = ? where draft_id = ? and user_id = ?')
      .run(cleanName(body.name), cleanDiscordId(body.discord_id), id, userId)
    if (result.changes === 0) throw notFound('You are not in this draft')
    pushPlayers(id)
    sendJson(res, 200, { ok: true })
  })

  route('DELETE', '/api/drafts/:id/players/:user', (req, res, [id, target]) => {
    const userId = requireUser(req, res)
    const row = requireDraft(id)
    inLobby(row)
    if (target !== userId && row.host_id !== userId) throw forbidden('Only the host can remove other players')
    if (target === row.host_id) throw forbidden('The host cannot leave; delete the draft instead')
    db.prepare('delete from draft_players where draft_id = ? and user_id = ?').run(id, target)
    pushPlayers(id)
    sendJson(res, 200, { ok: true })
  })

  route('GET', '/api/drafts/:id/webhook', (req, res, [id]) => {
    const userId = requireUser(req, res)
    if (requireDraft(id).host_id !== userId) throw forbidden('Only the host can see the webhook')
    const row = db.prepare('select discord_webhook from draft_secrets where draft_id = ?').get(id) as { discord_webhook: string | null } | undefined
    sendJson(res, 200, { discord_webhook: row?.discord_webhook ?? null })
  })

  route('PUT', '/api/drafts/:id/webhook', async (req, res, [id]) => {
    const userId = requireUser(req, res)
    if (requireDraft(id).host_id !== userId) throw forbidden('Only the host can set the webhook')
    const { discord_webhook } = await readJson<{ discord_webhook: unknown }>(req)
    const url = typeof discord_webhook === 'string' && discord_webhook.trim() ? discord_webhook.trim() : null
    if (url && !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) throw badRequest("That doesn't look like a Discord webhook URL")
    db.prepare('insert into draft_secrets (draft_id, discord_webhook) values (?, ?) on conflict (draft_id) do update set discord_webhook = excluded.discord_webhook').run(id, url)
    sendJson(res, 200, { ok: true })
  })

  route('POST', '/api/drafts/:id/actions', async (req, res, [id]) => {
    const userId = requireUser(req, res)
    const body = await readJson<{ version: number; action: DraftAction; link?: string }>(req)
    // Read, validate and save in one transaction: no one else can change the draft in between.
    const { before, after, players } = transaction(db, () => {
      const row = requireDraft(id)
      if (row.version !== body.version) throw new HttpError(409, 'The draft changed; try again')
      const players = getPlayers(id)
      let state: DraftState
      try {
        state = applyAction(row, userId, body.action, players)
      } catch (e) {
        if (e instanceof DraftError) throw badRequest(e.message)
        throw e
      }
      db.prepare('update drafts set state = ?, status = ?, version = version + 1, updated_at = ? where id = ?').run(JSON.stringify(state), state.status, now(), id)
      return { before: row.state ? (JSON.parse(row.state) as DraftState) : null, after: state, players }
    })
    pushDraft(id)
    sendJson(res, 200, { ok: true })
    await notifyDiscord(id, before, after, players, typeof body.link === 'string' ? body.link : undefined)
  })

  route('GET', '/api/photos', (req, res) => {
    requireUser(req, res)
    sendJson(res, 200, photoRows())
  })

  route('GET', '/api/photos/events', (req, res) => {
    requireUser(req, res)
    subscribe(req, res, 'photos')
  })

  route('GET', '/api/photo-editor', (req, res) => sendJson(res, 200, { isEditor: isEditor(requireUser(req, res)) }))

  route('POST', '/api/photo-editor/claim', async (req, res) => {
    const userId = requireUser(req, res)
    const { code } = await readJson<{ code: unknown }>(req)
    const ok = opts.photoCodeHash !== '' && typeof code === 'string' && sha256(code.trim()) === opts.photoCodeHash
    if (ok) db.prepare('insert into photo_editors (user_id, added_at) values (?, ?) on conflict do nothing').run(userId, now())
    sendJson(res, 200, { ok })
  })

  route('POST', '/api/photos/:unit', async (req, res, [unitId]) => {
    const userId = requireUser(req, res)
    requireEditor(userId)
    requireUnit(unitId)
    const body = await readJson<{ photo: unknown; photoType: unknown; thumb: unknown; thumbType: unknown }>(req)
    const stamp = Date.now()
    const path = savePhoto(unitId, body.photo, body.photoType, '', stamp)
    const thumbPath = savePhoto(unitId, body.thumb, body.thumbType, '-thumb', stamp)
    const previous = db.prepare('select path, thumb_path from unit_photos where unit_id = ?').get(unitId) as PhotoRow | undefined
    db.prepare(
      'insert into unit_photos (unit_id, path, thumb_path, updated_at, uploaded_by) values (?, ?, ?, ?, ?) on conflict (unit_id) do update set path = excluded.path, thumb_path = excluded.thumb_path, updated_at = excluded.updated_at, uploaded_by = excluded.uploaded_by',
    ).run(unitId, path, thumbPath, now(), userId)
    if (previous) {
      removePhotoFile(previous.path)
      removePhotoFile(previous.thumb_path)
    }
    const row = { unit_id: unitId, path, thumb_path: thumbPath }
    publish('photos', 'photo', row)
    sendJson(res, 200, row)
  })

  route('PUT', '/api/photos/:unit/thumb', async (req, res, [unitId]) => {
    const userId = requireUser(req, res)
    requireEditor(userId)
    const previous = db.prepare('select unit_id, path, thumb_path from unit_photos where unit_id = ?').get(unitId) as PhotoRow | undefined
    if (!previous) throw notFound('Add a photo first')
    const body = await readJson<{ thumb: unknown; thumbType: unknown }>(req)
    const thumbPath = savePhoto(unitId, body.thumb, body.thumbType, '-thumb', Date.now())
    db.prepare('update unit_photos set thumb_path = ?, updated_at = ? where unit_id = ?').run(thumbPath, now(), unitId)
    removePhotoFile(previous.thumb_path)
    const row = { unit_id: unitId, path: previous.path, thumb_path: thumbPath }
    publish('photos', 'photo', row)
    sendJson(res, 200, row)
  })

  // --- Static files -------------------------------------------------------------------------
  const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  }
  /** Serves a file from `base` if `rel` stays inside it. Returns false if there's no such file. */
  function serveFile(res: ServerResponse, base: string, rel: string, cache: string): boolean {
    const full = resolve(base, normalize(rel).replace(/^([/\\])+/, ''))
    if (!full.startsWith(resolve(base) + sep)) return false
    if (!existsSync(full) || !statSync(full).isFile()) return false
    res.writeHead(200, { 'Content-Type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': cache })
    createReadStream(full).pipe(res)
    return true
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound()
    if (path.startsWith('/photos/')) {
      // Photo files never change at a given path (each upload gets a new name).
      if (serveFile(res, photoDir, decodeURIComponent(path.slice('/photos/'.length)), 'public, max-age=31536000, immutable')) return
      throw notFound()
    }
    if (!opts.siteDir) throw notFound()
    const cache = path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    if (path !== '/' && serveFile(res, opts.siteDir, decodeURIComponent(path), cache)) return
    // Everything else is a page of the single-page app.
    if (!serveFile(res, opts.siteDir, 'index.html', 'no-cache')) throw notFound()
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    try {
      for (const [method, re, handler] of routes) {
        if (method !== req.method) continue
        const m = re.exec(path)
        if (m) {
          await handler(req, res, m.slice(1).map(decodeURIComponent))
          return
        }
      }
      if (path.startsWith('/api/')) throw notFound()
      serveStatic(req, res, path)
    } catch (e) {
      if (res.headersSent) {
        res.end()
        return
      }
      if (e instanceof HttpError) sendJson(res, e.status, { error: e.message })
      else {
        console.error(e)
        sendJson(res, 500, { error: 'Something went wrong' })
      }
    }
  })

  return { server, db }
}

/** The repository root (server/ lives one level below it). */
export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
