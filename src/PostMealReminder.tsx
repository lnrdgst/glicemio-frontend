import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from './database/db'
import { eventDateTime } from './shared/format'
import { nextPostMealCheck, postMealDismissalKey, postMealWindow, reminderInstant, selectPostMealReminder } from './shared/postMealReminder'

const empty = { meals: [], glucose: [] }
export function PostMealReminder({ enabled }: { enabled: boolean }) {
  const [clock, setClock] = useState(() => Date.now())
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [storageError, setStorageError] = useState(false)
  const [refreshVersion, refresh] = useState(0)
  useEffect(() => { if (enabled) setClock(Date.now()) }, [enabled])
  const data = useLiveQuery(async () => {
    if (!enabled) return empty
    const [meals, glucose] = await Promise.all([
      db.meals.filter(meal => { const at = reminderInstant(meal.at); return meal.timeReference === 'meal_start' && at !== undefined && at <= clock && clock - at < postMealWindow.hideFrom }).toArray(),
      db.glucose.filter(record => { const at = reminderInstant(record.at); return at !== undefined && at <= clock && clock - at <= postMealWindow.hideFrom - postMealWindow.measuredFrom }).toArray(),
    ])
    return { meals, glucose }
  }, [clock, enabled]) ?? empty
  useEffect(() => {
    if (!enabled) return
    const update = () => { setClock(Date.now()); refresh(value => value + 1) }
    const timer = window.setTimeout(update, nextPostMealCheck(data.meals, Date.now()))
    const storage = (event: StorageEvent) => { if (event.key === null || event.key.startsWith('glicemio-post-meal-dismissed:')) update() }
    document.addEventListener('visibilitychange', update); window.addEventListener('focus', update); window.addEventListener('pageshow', update); window.addEventListener('storage', storage)
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update); window.removeEventListener('pageshow', update); window.removeEventListener('storage', storage) }
  }, [enabled, clock, data.meals, refreshVersion])
  const dismissedIds = new Set(dismissed)
  for (const meal of data.meals) {
    try { if (localStorage.getItem(postMealDismissalKey(meal.id)) === '1') dismissedIds.add(meal.id) } catch { /* A dispensa em memória continua disponível. */ }
  }
  const meal = selectPostMealReminder({ ...data, now: clock, enabled, dismissedIds })
  if (!meal) return storageError ? <p className="muted" role="status">Lembrete dispensado nesta abertura. Não foi possível salvar a dispensa no dispositivo.</p> : null
  const dismiss = () => {
    setDismissed(ids => new Set([...ids, meal.id]))
    try { localStorage.setItem(postMealDismissalKey(meal.id), '1') } catch { setStorageError(true) }
  }
  return <aside className="post-meal-reminder" aria-label="Lembrete de glicemia após refeição" aria-live="polite">
    <b>Que tal registrar sua glicemia?</b>
    <p>{meal.kind} · Início: {eventDateTime(meal.at)}</p>
    <p>Já se passaram pelo menos 2 horas desde o início da refeição. Uma medição pode ajudar a acompanhar sua resposta aos alimentos.</p>
    <div className="actions"><Link className="secondary" to="/glicemia">Registrar glicemia</Link><button className="secondary" type="button" onClick={dismiss}>Dispensar</button></div>
  </aside>
}
