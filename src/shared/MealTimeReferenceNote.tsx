import type { Meal } from '../database/db'

export function MealTimeReferenceNote({ meal }: { meal: Pick<Meal, 'timeReference'> }) {
  if (meal.timeReference === 'meal_start' || meal.timeReference === 'meal_end') return null
  return <p className="muted">Este horário ainda não foi identificado como início ou fim da refeição. Por isso, não gera lembretes de glicemia pós-refeição.</p>
}
