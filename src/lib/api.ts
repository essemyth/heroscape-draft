// Talks to our own server (server/app.ts): JSON requests, the browser's session, live updates.

import { useEffect, useState } from 'react'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`)
  return data as T
}

export interface Session {
  user: { id: string }
}

/** The browser's identity. The server creates one (in a cookie) on first visit, so friends just open the link. */
export function useSession(): { session: Session | null; error: string | null } {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<{ userId: string }>('GET', '/api/session')
      .then(({ userId }) => setSession({ user: { id: userId } }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not connect'))
  }, [])
  return { session, error }
}

/**
 * Subscribes to a server-sent event stream. The browser reconnects by itself; `onOpen`
 * runs on every (re)connect so callers can catch up on anything missed.
 */
export function listen(path: string, handlers: Record<string, (data: unknown) => void>, onOpen?: () => void): () => void {
  const source = new EventSource(path)
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (e) => handler(JSON.parse((e as MessageEvent).data)))
  }
  if (onOpen) source.addEventListener('open', onOpen)
  return () => source.close()
}
