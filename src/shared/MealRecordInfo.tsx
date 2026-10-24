import type { Meal } from '../database/db'
import { eventDateTime } from './format'
import { mealTimeReferenceLabel } from './meals'

export function MealRecordInfo({ meal, compact = false }: { meal: Meal; compact?: boolean }) {
  return <div className="meal-record-info"><strong>{meal.kind}</strong><span className="muted">{eventDateTime(meal.at)}</span>{!compact && <span className="muted meal-time-reference">{mealTimeReferenceLabel(meal)}</span>}</div>
}
