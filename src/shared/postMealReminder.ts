import type { Glucose, Meal } from '../database/db'

const minute = 60_000
export const postMealWindow = { showFrom: 120 * minute, hideFrom: 180 * minute, measuredFrom: 90 * minute }

// Não atribua um fuso ou uma hora a datas incompletas importadas.
export function reminderInstant(value: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) return undefined
  const [, year, month, day, hour, minutes, seconds = '0'] = parts
  const calendar = new Date(0)
  calendar.setUTCFullYear(+year, +month - 1, +day); calendar.setUTCHours(+hour, +minutes, +seconds, 0)
  const instant = Date.parse(value)
  return calendar.getUTCFullYear() === +year && calendar.getUTCMonth() === +month - 1 && calendar.getUTCDate() === +day && calendar.getUTCHours() === +hour && calendar.getUTCMinutes() === +minutes && calendar.getUTCSeconds() === +seconds && Number.isFinite(instant) ? instant : undefined
}

type Input = { meals: Meal[]; glucose: Pick<Glucose, 'at'>[]; now: number; enabled?: boolean; dismissedIds?: ReadonlySet<string> }
export function selectPostMealReminder({ meals, glucose, now, enabled = true, dismissedIds }: Input): Meal | undefined {
  if (!enabled || !Number.isFinite(now)) return undefined
  const latest = meals.flatMap(meal => {
    const start = reminderInstant(meal.at)
    return meal.timeReference === 'meal_start' && start !== undefined && now - start >= postMealWindow.showFrom && now - start < postMealWindow.hideFrom ? [{ meal, start }] : []
  }).sort((a, b) => b.start - a.start || a.meal.id.localeCompare(b.meal.id))[0]
  // Não encadeie avisos mais antigos após dispensar o mais recente.
  if (!latest || dismissedIds?.has(latest.meal.id)) return undefined
  const measured = glucose.some(record => {
    const at = reminderInstant(record.at)
    return at !== undefined && at <= now && at - latest.start >= postMealWindow.measuredFrom && at - latest.start <= postMealWindow.hideFrom
  })
  return measured ? undefined : latest.meal
}

export function nextPostMealCheck(meals: Meal[], now: number) {
  let delay = 30_000
  for (const meal of meals) {
    if (meal.timeReference !== 'meal_start') continue
    const start = reminderInstant(meal.at)
    if (start === undefined) continue
    for (const boundary of [postMealWindow.showFrom, postMealWindow.hideFrom]) {
      const remaining = start + boundary - now
      if (remaining > 0) delay = Math.min(delay, remaining)
    }
  }
  return delay
}

export const postMealDismissalKey = (mealId: string) => `glicemio-post-meal-dismissed:${mealId}`

// Compare o evento, sem invalidar por descrição, updatedAt ou formato equivalente do fuso.
export const postMealDismissalValue = (meal: Pick<Meal, 'at' | 'timeReference'>) =>
  JSON.stringify({ version: 1, at: reminderInstant(meal.at) ?? meal.at, timeReference: meal.timeReference ?? 'unconfirmed' })
