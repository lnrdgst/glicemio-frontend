import { db, mealItemUnits, type Food, type Meal, type MealItem } from './db'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const isUUID = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const name = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200
export const isMealQuantity = (value: unknown): value is string => typeof value === 'string' && /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value)

// Compara microssegundos sem truncar nem atribuir fuso a datas incompletas.
function instant(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return undefined
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts) return undefined
  const [, year, month, day, hour, minute, second, fraction = ''] = parts
  const calendar = new Date(0)
  calendar.setUTCFullYear(+year, +month - 1, +day); calendar.setUTCHours(+hour, +minute, +second, 0)
  const millis = Date.parse(value)
  if (+year < 1 || calendar.getUTCFullYear() !== +year || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day || calendar.getUTCHours() !== +hour || calendar.getUTCMinutes() !== +minute || calendar.getUTCSeconds() !== +second || !Number.isFinite(millis) || millis < Date.parse('0001-01-01T00:00:00Z') || millis > Date.parse('9999-12-31T23:59:59.999Z')) return undefined
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3))
}

function metadata(record: Record<string, unknown>) {
  const created = instant(record.createdAt), updated = instant(record.updatedAt), deleted = instant(record.deletedAt)
  return isUUID(record.id) && Number.isSafeInteger(record.revision) && Number(record.revision) > 0 && created !== undefined && updated !== undefined && updated >= created && (record.deletedAt === undefined || (deleted !== undefined && deleted >= created && deleted <= updated))
}
export function isFood(value: unknown): value is Food { return object(value) && metadata(value) && name(value.name) }
export function isMealItem(value: unknown): value is MealItem {
  return object(value) && metadata(value) && isUUID(value.mealId) && (value.foodId === undefined || isUUID(value.foodId)) && name(value.foodName) && isMealQuantity(value.quantity) && mealItemUnits.includes(value.unit as MealItem['unit'])
}

// A ordem das propriedades JSON não transforma uma duplicata em conflito.
export function recordSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(recordSignature).join(',')}]`
  if (object(value)) return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${recordSignature(entry)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const sameRecord = (left: unknown, right: unknown) => recordSignature(left) === recordSignature(right)

function checkRevision(next: Food | MealItem, previous?: Food | MealItem) {
  if (!previous) {
    if (next.revision !== 1) throw new Error('Um novo registro deve começar na revisão 1.')
    return
  }
  if (!metadata(previous) || previous.deletedAt || next.revision !== previous.revision + 1 || next.createdAt !== previous.createdAt || instant(next.updatedAt)! <= instant(previous.updatedAt)!) throw new Error('Conflito de revisão ou metadados. Releia o registro antes de salvar.')
}

/** Operação local; não representa uma revisão confirmada por servidor. */
export async function saveFood(food: Food) {
  food = structuredClone(food)
  if (!isFood(food)) throw new Error('Alimento inválido.')
  return db.transaction('rw', db.foods, async () => {
    checkRevision(food, await db.foods.get(food.id))
    await db.foods.put(food)
  })
}

/** Grava somente os itens fornecidos, sem apagar implicitamente os omitidos. */
export async function saveMealWithItems(meal: Meal, items: MealItem[], expectedMeal?: Meal) {
  meal = structuredClone(meal); items = structuredClone(items); expectedMeal = structuredClone(expectedMeal)
  if (!isUUID(meal.id) || typeof meal.kind !== 'string' || !meal.kind.trim() || meal.kind.length > 80 || instant(meal.at) === undefined || instant(meal.createdAt) === undefined || instant(meal.updatedAt) === undefined || instant(meal.updatedAt)! < instant(meal.createdAt)! || (meal.description !== undefined && (typeof meal.description !== 'string' || meal.description.length > 10000)) || (meal.timeReference !== undefined && !['meal_start', 'meal_end', 'unconfirmed'].includes(meal.timeReference))) throw new Error('Refeição inválida.')
  if (!items.every(isMealItem) || items.some(item => item.mealId !== meal.id) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('Itens ou referências da refeição inválidos.')
  return db.transaction('rw', [db.meals, db.mealItems, db.foods], async () => {
    const previousMeal = await db.meals.get(meal.id)
    if (meal.deletedAt || previousMeal?.deletedAt || (previousMeal ? !expectedMeal || !sameRecord(previousMeal, expectedMeal) : expectedMeal !== undefined)) throw new Error('Conflito na refeição. Releia o registro antes de salvar.')
    if (previousMeal && (meal.createdAt !== previousMeal.createdAt || instant(meal.updatedAt)! < instant(previousMeal.updatedAt)!)) throw new Error('Metadados da refeição não podem retroceder.')
    for (const item of items) {
      const previous = await db.mealItems.get(item.id)
      if (previous && previous.mealId !== meal.id) throw new Error('O item já pertence a outra refeição.')
      checkRevision(item, previous)
      if (item.foodId) {
        const food = await db.foods.get(item.foodId)
        if (!food || (food.deletedAt && previous?.foodId !== item.foodId)) throw new Error('O alimento referenciado está indisponível.')
      }
    }
    await db.meals.put(meal)
    if (items.length) await db.mealItems.bulkPut(items)
  })
}
