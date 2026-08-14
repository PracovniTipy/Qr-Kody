import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

/**
 * Jednoduchá ochrana admin routy: bez platné Supabase session přesměruje na /admin/login.
 * Skutečné oddělení dat mezi hospodami řeší RLS pravidla v databázi, ne tato komponenta —
 * tohle je jen UX zkratka, ne bezpečnostní hranice.
 */
export function ProtectedRoute() {
  const [checking, setChecking] = useState(true)
  const [isAuthed, setIsAuthed] = useState(false)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setIsAuthed(Boolean(data.session))
      setChecking(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session))
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  if (checking) return <p style={{ padding: 24 }}>Načítám…</p>
  if (!isAuthed) return <Navigate to="/admin/login" replace />

  return <Outlet />
}
