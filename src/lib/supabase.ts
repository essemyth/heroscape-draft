import { createClient, FunctionsHttpError, type Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')

/**
 * Signs in anonymously if needed and returns the session. Each browser keeps its
 * own identity, so friends just open the invite link and pick a name.
 */
export function useSession(): { session: Session | null; error: string | null } {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabaseConfigured) return
    let cancelled = false
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        if (!cancelled) setSession(data.session)
        return
      }
      const { data: signedIn, error } = await supabase.auth.signInAnonymously()
      if (cancelled) return
      if (error) setError(error.message)
      else setSession(signedIn.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s) setSession(s)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  return { session, error }
}

/** Pulls the server's error message out of a failed edge function call. */
export async function functionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body?.error) return body.error
    } catch {
      // Fall through to the generic message.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong'
}
