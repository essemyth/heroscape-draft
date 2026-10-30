import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, projectRoot } from './app.ts'

const CODE = 'test-photo-code'
let base = ''
let dataDir = ''
let close: () => void

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'hsd-test-'))
  const { server, db } = createApp({ rootDir: projectRoot, dataDir, photoCodeHash: createHash('sha256').update(CODE).digest('hex') })
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => {
    server.close()
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
afterAll(() => close())

/** A browser: keeps its own session cookie. */
async function browser() {
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()
    return { status: res.status, data }
  }
  const { data } = await call('GET', '/api/session')
  return { id: (data as { userId: string }).userId, call, cookie: () => cookie }
}

const settings = (host: string) => ({
  format: 'normal',
  pointsTotal: 300,
  groups: ['Hasbro', 'Renegade', 'Prerelease'],
  timerSeconds: null,
  collectionId: 'spenceralansmith',
  playerOrder: [host],
})

async function startedDraft() {
  const alice = await browser()
  const bob = await browser()
  const { data } = await alice.call('POST', '/api/drafts', { hostName: 'Alice', settings: settings(alice.id) })
  const id = (data as { id: string }).id
  await bob.call('POST', `/api/drafts/${id}/players`, { name: 'Bob' })
  await alice.call('PATCH', `/api/drafts/${id}/settings`, { settings: { ...settings(alice.id), playerOrder: [alice.id, bob.id] } })
  const act = async (who: typeof alice, action: unknown) => {
    const { data: room } = await who.call('GET', `/api/drafts/${id}`)
    return who.call('POST', `/api/drafts/${id}/actions`, { version: (room as { draft: { version: number } }).draft.version, action })
  }
  return { alice, bob, id, act }
}

describe('sessions', () => {
  it('gives each browser its own lasting identity', async () => {
    const a = await browser()
    const b = await browser()
    expect(a.id).not.toBe(b.id)
    expect((await a.call('GET', '/api/session')).data).toEqual({ userId: a.id })
  })

  it('rejects API calls without a session', async () => {
    expect((await fetch(`${base}/api/drafts/mine`)).status).toBe(401)
  })
})

describe('lobby permissions', () => {
  it('only the host edits settings, and only in the lobby', async () => {
    const { alice, bob, id, act } = await startedDraft()
    expect((await bob.call('PATCH', `/api/drafts/${id}/settings`, { settings: settings(bob.id) })).status).toBe(403)
    expect((await act(bob, { type: 'start' })).status).toBe(400)
    expect((await act(alice, { type: 'start' })).status).toBe(200)
    expect((await alice.call('PATCH', `/api/drafts/${id}/settings`, { settings: settings(alice.id) })).status).toBe(403)
  })

  it('only the host sees and sets the webhook', async () => {
    const { alice, bob, id } = await startedDraft()
    expect((await bob.call('GET', `/api/drafts/${id}/webhook`)).status).toBe(403)
    expect((await alice.call('PUT', `/api/drafts/${id}/webhook`, { discord_webhook: 'https://example.com/x' })).status).toBe(400)
    expect((await alice.call('PUT', `/api/drafts/${id}/webhook`, { discord_webhook: 'https://discord.com/api/webhooks/1/abc' })).status).toBe(200)
    expect((await alice.call('GET', `/api/drafts/${id}/webhook`)).data).toEqual({ discord_webhook: 'https://discord.com/api/webhooks/1/abc' })
  })

  it('players edit their own seat; the host can remove others', async () => {
    const { alice, bob, id } = await startedDraft()
    expect((await bob.call('PATCH', `/api/drafts/${id}/players/me`, { name: 'Bobby', discord_id: '123456789012' })).status).toBe(200)
    expect((await bob.call('PATCH', `/api/drafts/${id}/players/me`, { name: 'Bobby', discord_id: 'abc' })).status).toBe(400)
    expect((await bob.call('DELETE', `/api/drafts/${id}/players/${alice.id}`)).status).toBe(403)
    expect((await alice.call('DELETE', `/api/drafts/${id}/players/${bob.id}`)).status).toBe(200)
    const { data } = await alice.call('GET', `/api/drafts/${id}`)
    expect((data as { players: unknown[] }).players).toHaveLength(1)
  })
})

describe('draft actions', () => {
  it('enforces turns, versions, budgets and host-only actions', async () => {
    const { alice, bob, id, act } = await startedDraft()
    expect((await act(alice, { type: 'start' })).status).toBe(200)
    const { data: room } = await alice.call('GET', `/api/drafts/${id}`)
    const state = (room as { draft: { state: { pool: Record<string, number> } } }).draft.state
    const unitIds = Object.keys(state.pool)

    const wrongTurn = await act(bob, { type: 'pick', unitId: unitIds[0] })
    expect(wrongTurn.status).toBe(400)
    expect((wrongTurn.data as { error: string }).error).toMatch(/turn/)

    expect((await act(alice, { type: 'pick', unitId: 'marro-drudge' })).status).toBe(200)
    // Acting on an old version is refused.
    expect((await alice.call('POST', `/api/drafts/${id}/actions`, { version: 0, action: { type: 'pass' } })).status).toBe(409)
    expect((await act(bob, { type: 'undo' })).status).toBe(400)
    expect((await act(alice, { type: 'timeout' })).status).toBe(400)
    expect((await act(bob, { type: 'end' })).status).toBe(400)
    expect((await act(alice, { type: 'end' })).status).toBe(200)
    const { data: done } = await alice.call('GET', `/api/drafts/${id}`)
    expect((done as { draft: { status: string } }).draft.status).toBe('complete')
  })

  it('only the host deletes, and players go with the draft', async () => {
    const { alice, bob, id } = await startedDraft()
    expect((await bob.call('DELETE', `/api/drafts/${id}`)).status).toBe(403)
    expect((await alice.call('DELETE', `/api/drafts/${id}`)).status).toBe(200)
    expect((await alice.call('GET', `/api/drafts/${id}`)).status).toBe(404)
    expect((await bob.call('GET', '/api/drafts/mine')).data).toEqual([])
  })

  it('streams live updates to other players', async () => {
    const { alice, bob, id, act } = await startedDraft()
    const res = await fetch(`${base}/api/drafts/${id}/events`, { headers: { cookie: bob.cookie() } })
    const reader = res.body!.getReader()
    await act(alice, { type: 'start' })
    let text = ''
    const deadline = Date.now() + 3000
    while (!text.includes('"status":"drafting"') && Date.now() < deadline) {
      const { value } = await reader.read()
      text += new TextDecoder().decode(value)
    }
    await reader.cancel()
    expect(text).toContain('event: draft')
    expect(text).toContain('"status":"drafting"')
  })
})

describe('photos', () => {
  const tinyWebp = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64').toString('base64')

  it('requires the photo code, then stores, serves and replaces photos', async () => {
    const editor = await browser()
    const upload = { photo: tinyWebp, photoType: 'image/webp', thumb: tinyWebp, thumbType: 'image/webp' }
    expect((await editor.call('POST', '/api/photos/grimnak', upload)).status).toBe(403)
    expect((await editor.call('POST', '/api/photo-editor/claim', { code: 'nope' })).data).toEqual({ ok: false })
    expect((await editor.call('POST', '/api/photo-editor/claim', { code: CODE })).data).toEqual({ ok: true })
    expect((await editor.call('GET', '/api/photo-editor')).data).toEqual({ isEditor: true })

    const first = await editor.call('POST', '/api/photos/grimnak', upload)
    expect(first.status).toBe(200)
    const path = (first.data as { path: string }).path
    const served = await fetch(`${base}/photos/${path}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/webp')

    await new Promise((r) => setTimeout(r, 5))
    const second = await editor.call('POST', '/api/photos/grimnak', upload)
    expect((await fetch(`${base}/photos/${path}`)).status).toBe(404) // old file removed
    expect((await fetch(`${base}/photos/${(second.data as { path: string }).path}`)).status).toBe(200)

    const thumb = await editor.call('PUT', '/api/photos/grimnak/thumb', { thumb: tinyWebp, thumbType: 'image/webp' })
    expect(thumb.status).toBe(200)
    expect((await editor.call('GET', '/api/photos')).data).toEqual([thumb.data])
  })

  it('refuses unknown units, bad types and path tricks', async () => {
    const editor = await browser()
    await editor.call('POST', '/api/photo-editor/claim', { code: CODE })
    expect((await editor.call('POST', '/api/photos/not-a-unit', { photo: tinyWebp, photoType: 'image/webp', thumb: tinyWebp, thumbType: 'image/webp' })).status).toBe(404)
    expect((await editor.call('POST', '/api/photos/grimnak', { photo: tinyWebp, photoType: 'image/png', thumb: tinyWebp, thumbType: 'image/webp' })).status).toBe(400)
    expect((await fetch(`${base}/photos/..%2F..%2Fheroscape.db`)).status).toBe(404)
  })
})
