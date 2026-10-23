import type { Meal } from '../database/db'

export const mealTimeReferenceLabel = (meal: Pick<Meal, 'timeReference'>) =>
  meal.timeReference === 'meal_start' ? 'Início da refeição' : meal.timeReference === 'meal_end' ? 'Fim da refeição' : 'Referência não confirmada'
