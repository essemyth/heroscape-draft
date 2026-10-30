import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, listen } from './api'
import { collections, DEFAULT_GROUPS } from './data'
import type { DraftAction, DraftState, LobbySettings } from './types'

export interface DraftRow {
  id: string
  host_id: string
  status: 'lobby' | 'drafting' | 'complete'
  settings: LobbySettings
  state: DraftState | null
  version: number
  created_at: string
}

export interface PlayerRow {
  draft_id: string
  user_id: string
  name: string
  discord_id: string | null
  joined_at: string
}

const NAME_KEY = 'heroscape-draft:name'

export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Not remembered; they'll type it again next time.
  }
}

export async function createDraft(userId: string, hostName: string): Promise<string> {
  const settings: LobbySettings = {
    format: 'normal',
    pointsTotal: 500,
    groups: DEFAULT_GROUPS,
    timerSeconds: null,
    collectionId: Object.keys(collections)[0] ?? '',
    playerOrder: [userId],
  }
  const { id } = await api<{ id: string }>('POST', '/api/drafts', { hostName, settings })
  return id
}

/** Drafts this user hosts or has joined, newest first. */
export async function myDrafts(_userId: string) {
  return api<Pick<DraftRow, 'id' | 'status' | 'created_at' | 'host_id' | 'settings'>[]>('GET', '/api/drafts/mine')
}

/** Host only (checked by the server). Players and the webhook go with it. */
export async function deleteDraft(draftId: string): Promise<void> {
  await api('DELETE', `/api/drafts/${draftId}`)
}

export async function sendAction(draft: DraftRow, action: DraftAction): Promise<void> {
  await api('POST', `/api/drafts/${draft.id}/actions`, { version: draft.version, action, link: window.location.href })
}

// --- Lobby ------------------------------------------------------------------------------------

export const updateSettings = (draftId: string, settings: LobbySettings) => api('PATCH', `/api/drafts/${draftId}/settings`, { settings })
export const joinDraft = (draftId: string, name: string) => api('POST', `/api/drafts/${draftId}/players`, { name })
export const updateSeat = (draftId: string, name: string, discordId: string | null) =>
  api('PATCH', `/api/drafts/${draftId}/players/me`, { name, discord_id: discordId })
export const removePlayer = (draftId: string, userId: string) => api('DELETE', `/api/drafts/${draftId}/players/${userId}`)
export const getWebhook = (draftId: string) => api<{ discord_webhook: string | null }>('GET', `/api/drafts/${draftId}/webhook`)
export const setWebhook = (draftId: string, url: string | null) => api('PUT', `/api/drafts/${draftId}/webhook`, { discord_webhook: url })

/** Loads a draft and its players and keeps them current with live updates. */
export function useDraftRoom(draftId: string) {
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  const load = useCallback(async () => {
    try {
      const room = await api<{ draft: DraftRow; players: PlayerRow[] }>('GET', `/api/drafts/${draftId}`)
      setDraft(room.draft)
      setPlayers(room.players)
      setMissing(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setDraft(null)
        setMissing(true)
      }
    }
  }, [draftId])

  useEffect(() => {
    load().finally(() => setLoading(false))

    const stop = listen(
      `/api/drafts/${draftId}/events`,
      {
        draft: (data) => {
          // Ignore stale events that arrive out of order.
          const next = data as DraftRow
          setDraft((cur) => (cur && cur.version > next.version ? cur : next))
          setMissing(false)
        },
        players: (data) => setPlayers(data as PlayerRow[]),
        deleted: () => {
          setDraft(null)
          setMissing(true)
        },
      },
      // Catch up on anything missed while (re)connecting.
      () => load(),
    )

    // Phones drop connections in the background; refresh when the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      stop()
    }
  }, [draftId, load])

  return { draft, players, loading, missing, reload: load }
}
