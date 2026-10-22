import { useCallback, useEffect, useState } from 'react'
import { collections, DEFAULT_GROUPS } from './data'
import { functionErrorMessage, supabase } from './supabase'
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
  const { data, error } = await supabase.from('drafts').insert({ settings }).select('id').single()
  if (error) throw error
  const { error: joinError } = await supabase.from('draft_players').insert({ draft_id: data.id, name: hostName })
  if (joinError) throw joinError
  return data.id
}

/** Drafts this user hosts or has joined, newest first. */
export async function myDrafts(userId: string) {
  const { data, error } = await supabase
    .from('draft_players')
    .select('draft_id, drafts(id, status, created_at, host_id, settings)')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? [])
    .map((r) => r.drafts as unknown as Pick<DraftRow, 'id' | 'status' | 'created_at' | 'host_id' | 'settings'>)
    .filter(Boolean)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function sendAction(draft: DraftRow, action: DraftAction): Promise<void> {
  const { error } = await supabase.functions.invoke('draft-action', {
    body: { draftId: draft.id, version: draft.version, action, link: window.location.href },
  })
  if (error) throw new Error(await functionErrorMessage(error))
}

/** Loads a draft and its players and keeps them current via Realtime. */
export function useDraftRoom(draftId: string) {
  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  const loadDraft = useCallback(async () => {
    const { data } = await supabase.from('drafts').select('*').eq('id', draftId).maybeSingle()
    setDraft(data as DraftRow | null)
    setMissing(!data)
  }, [draftId])

  const loadPlayers = useCallback(async () => {
    const { data } = await supabase.from('draft_players').select('*').eq('draft_id', draftId).order('joined_at')
    setPlayers((data ?? []) as PlayerRow[])
  }, [draftId])

  useEffect(() => {
    Promise.all([loadDraft(), loadPlayers()]).finally(() => setLoading(false))

    const channel = supabase
      .channel(`draft:${draftId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setDraft(null)
          setMissing(true)
        } else {
          // Ignore stale events that arrive out of order.
          const next = payload.new as DraftRow
          setDraft((cur) => (cur && cur.version > next.version ? cur : next))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_players', filter: `draft_id=eq.${draftId}` }, () => {
        loadPlayers()
      })
      .subscribe((status) => {
        // Catch up on anything missed while (re)connecting.
        if (status === 'SUBSCRIBED') {
          loadDraft()
          loadPlayers()
        }
      })

    // Phones drop sockets in the background; refresh when the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadDraft()
        loadPlayers()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [draftId, loadDraft, loadPlayers])

  return { draft, players, loading, missing, reload: loadDraft }
}
