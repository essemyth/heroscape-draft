import { useEffect, useState } from 'react'
import { createDraft, deleteDraft, myDrafts, saveName, savedName, type DraftRow } from '../lib/online'
import { FORMAT_LABELS } from '../lib/types'

type DraftSummary = Pick<DraftRow, 'id' | 'status' | 'created_at' | 'host_id' | 'settings'>

const STATUS_LABELS: Record<DraftRow['status'], string> = {
  lobby: 'In lobby',
  drafting: 'Drafting',
  complete: 'Complete',
}

interface Props {
  me: string
  navigate: (path: string) => void
  onError: (message: string) => void
}

export function Home({ me, navigate, onError }: Props) {
  const [name, setName] = useState(savedName)
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null)

  useEffect(() => {
    myDrafts(me)
      .then(setDrafts)
      .catch((e) => onError(e.message))
  }, [me, onError])

  const remove = async (d: DraftSummary) => {
    const what = d.status === 'drafting' ? 'This draft is still in progress. Delete it for everyone?' : 'Delete this draft for everyone?'
    if (!window.confirm(`${what} This can't be undone.`)) return
    try {
      await deleteDraft(d.id)
      setDrafts((ds) => ds?.filter((x) => x.id !== d.id) ?? null)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not delete the draft')
    }
  }

  const create = async () => {
    setBusy(true)
    try {
      saveName(name.trim())
      navigate(`/d/${await createDraft(me, name.trim())}`)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create the draft')
      setBusy(false)
    }
  }

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>HeroScape Draft</h1>
        <p className="muted">Snake-draft armies with friends from the host's collection.</p>
      </header>

      <section className="panel">
        <h2>Host a draft</h2>
        <div className="button-row">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={40} aria-label="Your name" />
          <button type="button" className="primary" disabled={!name.trim() || busy} onClick={create}>
            Create draft
          </button>
        </div>
        <p className="muted">You'll get an invite link to send your friends.</p>
      </section>

      <section className="panel">
        <h2>Unit photos</h2>
        <p className="muted">See which of your units still need a photo, and take them with your phone.</p>
        <button type="button" onClick={() => navigate('/photos')}>
          📷 Unit photos
        </button>
      </section>

      {drafts && drafts.length > 0 && (
        <section className="panel">
          <h2>Your drafts</h2>
          <ul className="draft-list">
            {drafts.map((d) => (
              <li key={d.id}>
                <a
                  href={`/d/${d.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/d/${d.id}`)
                  }}
                >
                  {FORMAT_LABELS[d.settings.format]} · {d.settings.pointsTotal} pts
                </a>
                <span className="muted">
                  {STATUS_LABELS[d.status]}
                  {d.host_id === me ? ' · you host' : ''} · {new Date(d.created_at).toLocaleDateString()}
                </span>
                {d.host_id === me && (
                  <button type="button" className="danger small" onClick={() => remove(d)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
