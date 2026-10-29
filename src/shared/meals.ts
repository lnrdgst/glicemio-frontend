import { mealItemUnits, type Meal, type MealItem, type MealItemUnit } from '../database/db'

export const mealUnitLabels: Record<MealItemUnit, string> = { g: 'Grama (g)', kg: 'Quilograma (kg)', mg: 'Miligrama (mg)', mL: 'Mililitro (mL)', L: 'Litro (L)', unit: 'Unidade', portion: 'Porção', tsp: 'Colher de chá', tbsp: 'Colher de sopa', cup: 'Xícara', slice: 'Fatia' }
export const sortedMealItemUnits = [...mealItemUnits].sort((a, b) => mealUnitLabels[a].localeCompare(mealUnitLabels[b], 'pt-BR'))

export function formatMealItemQuantity({ quantity, unit }: Pick<MealItem, 'quantity' | 'unit'>) {
  const displayQuantity = quantity.replace('.', ',')
  // Compare a string decimal sem perder precisão nem remover casas armazenadas.
  if (unit === 'slice') return `${displayQuantity} ${/^1(?:\.0+)?$/.test(quantity) ? 'fatia' : 'fatias'}`
  return `${displayQuantity} · ${mealUnitLabels[unit]}`
}

export const mealTimeReferenceLabel = (meal: Pick<Meal, 'timeReference'>) =>
  meal.timeReference === 'meal_start' ? 'Início da refeição' : meal.timeReference === 'meal_end' ? 'Fim da refeição' : 'Referência não confirmada'

export const mealTimeFieldLabel = (meal: Pick<Meal, 'timeReference'>) =>
  meal.timeReference === 'meal_start' ? 'Hora do início da refeição' : meal.timeReference === 'meal_end' ? 'Hora do fim da refeição' : 'Hora da refeição (referência não confirmada)'
