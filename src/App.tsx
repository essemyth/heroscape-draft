import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CollectionPage } from './components/CollectionPage'
import { DraftBoard } from './components/DraftBoard'
import { Home } from './components/Home'
import { Lobby } from './components/Lobby'
import { PhotosPage } from './components/PhotosPage'
import { deleteDraft, sendAction, useDraftRoom } from './lib/online'
import { supabaseConfigured, useSession } from './lib/supabase'
import type { DraftAction } from './lib/types'

function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to)
    setPath(to)
    window.scrollTo(0, 0)
  }, [])
  return [path, navigate]
}

export default function App() {
  const { session, error: authError } = useSession()
  const [path, navigate] = usePath()
  const [error, setError] = useState<string | null>(null)

  if (!supabaseConfigured) {
    return (
      <Message title="Not connected">
        Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> and restart the dev
        server.
      </Message>
    )
  }
  if (authError) return <Message title="Couldn't sign in">{authError}</Message>
  if (!session) return <Message title="Connecting…" />

  const me = session.user.id
  const draftId = path.match(/^\/d\/([0-9a-f-]{36})\/?$/)?.[1]

  return (
    <>
      {error && (
        <div className="toast" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {draftId ? (
        <DraftRoom key={draftId} draftId={draftId} me={me} navigate={navigate} onError={setError} />
      ) : path.startsWith('/collection') ? (
        <CollectionPage me={me} navigate={navigate} />
      ) : path.startsWith('/photos') ? (
        <PhotosPage me={me} navigate={navigate} />
      ) : (
        <Home me={me} navigate={navigate} onError={setError} />
      )}
    </>
  )
}

function DraftRoom({ draftId, me, navigate, onError }: { draftId: string; me: string; navigate: (p: string) => void; onError: (m: string) => void }) {
  const { draft, players, loading, missing, reload } = useDraftRoom(draftId)

  const onAction = useCallback(
    async (action: DraftAction, opts?: { quiet?: boolean }): Promise<boolean> => {
      if (!draft) return false
      try {
        await sendAction(draft, action)
        onError('')
        return true
      } catch (e) {
        if (!opts?.quiet) onError(e instanceof Error ? e.message : 'Something went wrong')
        // Our copy may be stale (e.g. someone else acted first); make sure we have the latest.
        reload()
        return false
      }
    },
    [draft, onError, reload],
  )

  const onDelete = async () => {
    try {
      await deleteDraft(draftId)
      navigate('/')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete the draft')
    }
  }

  if (loading) return <Message title="Loading draft…" />
  if (missing || !draft) {
    return (
      <Message title="Draft not found">
        <p>It may have been deleted by the host.</p>
        <button type="button" onClick={() => navigate('/')}>
          Home
        </button>
      </Message>
    )
  }

  if (draft.status === 'lobby' || !draft.state) {
    return <Lobby draft={draft} players={players} me={me} onStart={async () => {
          await onAction({ type: 'start' })
        }} onDelete={onDelete} onError={onError} />
  }
  return <DraftBoard state={draft.state} me={me} isHost={draft.host_id === me} onAction={onAction} onHome={() => navigate('/')} onDelete={onDelete} />
}

function Message({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="lobby">
      <section className="panel">
        <h2>{title}</h2>
        {children && <div className="muted">{children}</div>}
      </section>
    </div>
  )
}
