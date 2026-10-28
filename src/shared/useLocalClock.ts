import { useEffect, useState } from 'react'

/** Reavalia janelas locais ao voltar à aplicação e exatamente na próxima meia-noite. */
export function useLocalClock(nextEventAt?: number) {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const update = () => setClock(new Date())
    const current = new Date()
    const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)
    const boundary = nextEventAt !== undefined && nextEventAt > current.getTime() ? nextEventAt - current.getTime() : 30_000
    const timer = window.setTimeout(update, Math.min(30_000, midnight.getTime() - current.getTime(), boundary))
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
    }
  }, [clock, nextEventAt])
  return clock
}
