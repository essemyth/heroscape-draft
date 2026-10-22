import { useCallback, useEffect, useState } from 'react'
import { DraftBoard } from './components/DraftBoard'
import { Lobby } from './components/Lobby'
import { unitIndex } from './lib/data'
import { DraftError, currentPlayer, makePick, passDraft, startDraft, timeoutPick, undoLast } from './lib/draft'
import type { DraftSettings, DraftState } from './lib/types'

const STORAGE_KEY = 'heroscape-draft:state'

function loadDraft(): DraftState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DraftState) : null
  } catch {
    return null
  }
}

export default function App() {
  const [draft, setDraft] = useState<DraftState | null>(loadDraft)
  const [lastSettings, setLastSettings] = useState<DraftSettings | undefined>(draft?.settings)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (draft) localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage unavailable (private window etc.); the draft just won't survive a refresh.
    }
  }, [draft])

  // Applies a draft action, surfacing rule violations instead of crashing.
  const act = useCallback(
    (fn: (s: DraftState) => DraftState) => {
      if (!draft) return
      try {
        setDraft(fn(draft))
        setError(null)
      } catch (e) {
        if (!(e instanceof DraftError)) throw e
        setError(e.message)
      }
    },
    [draft],
  )

  const onTimeout = useCallback(() => act((s) => timeoutPick(s, unitIndex, Date.now())), [act])

  if (!draft) {
    return (
      <Lobby
        initial={lastSettings}
        onStart={(settings, pool) => {
          setLastSettings(settings)
          setDraft(startDraft(settings, pool, unitIndex, Date.now()))
        }}
      />
    )
  }

  return (
    <>
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <DraftBoard
        state={draft}
        onPick={(unitId) => act((s) => makePick(s, currentPlayer(s)!.id, unitId, unitIndex, Date.now()))}
        onPass={() => act((s) => passDraft(s, currentPlayer(s)!.id, unitIndex, Date.now()))}
        onTimeout={onTimeout}
        onUndo={() => act((s) => undoLast(s, unitIndex, Date.now()))}
        onNewDraft={() => setDraft(null)}
      />
    </>
  )
}
