import { db, id, stamp, type Food, type Meal, type MealItem, type MealItemUnit } from './db'
import { isFood, isMealItem, isMealQuantity, sameRecord, saveFood, saveMealWithItems } from './structuredMeals'

export type MealItemDraft = { id: string; foodName: string; quantity: string; unit: MealItemUnit | ''; foodId?: string; createFood?: boolean }
export class MealFormError extends Error {}
export const emptyMealItem = (): MealItemDraft => ({ id: id(), foodName: '', quantity: '', unit: '' })
export const draftFromMealItem = (item: MealItem): MealItemDraft => ({ id: item.id, foodName: item.foodName, quantity: item.quantity, unit: item.unit, foodId: item.foodId })
export const nextMealUpdate = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
const sorted = (items: MealItem[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))

/** Catálogo novo, refeição, alterações e exclusões lógicas constituem uma só transação. */
export async function saveMealForm(meal: Meal, drafts: MealItemDraft[], originalItems: MealItem[], expectedMeal?: Meal) {
  meal = structuredClone(meal); drafts = structuredClone(drafts); originalItems = structuredClone(originalItems); expectedMeal = structuredClone(expectedMeal)
  if (new Set(drafts.map(item => item.id)).size !== drafts.length) throw new MealFormError('Há itens duplicados nesta refeição.')
  const originals = new Map(originalItems.map(item => [item.id, item]))
  const foods: Food[] = [], changes: MealItem[] = []
  for (const draft of drafts) {
    const original = originals.get(draft.id)
    const foodName = original?.foodName === draft.foodName ? draft.foodName : draft.foodName.trim()
    const quantity = draft.quantity.trim().replace(',', '.').replace(/^0+(?=\d)/, '')
    if (!foodName || foodName.length > 200) throw new MealFormError('Informe o nome de cada alimento, com até 200 caracteres.')
    if (!isMealQuantity(quantity)) throw new MealFormError('Informe uma quantidade maior que zero, com até 12 dígitos inteiros e 6 casas decimais. Nenhum valor será arredondado.')
    if (draft.createFood) {
      const food = { ...stamp({ name: foodName, revision: 1 }), id: draft.foodId }
      if (!isFood(food)) throw new MealFormError('O cadastro do novo alimento é inválido. Selecione novamente a opção de cadastrar.')
      foods.push(food)
    }
    const business = { mealId: meal.id, foodName, quantity, unit: draft.unit, foodId: draft.foodId }
    if (original && sameRecord(business, { mealId: original.mealId, foodName: original.foodName, quantity: original.quantity, unit: original.unit, foodId: original.foodId })) continue
    const item = original
      ? { ...original, ...business, updatedAt: nextMealUpdate(original.updatedAt), revision: original.revision + 1 }
      : { ...stamp(business), id: draft.id, revision: 1 }
    if (!isMealItem(item)) throw new MealFormError('Selecione uma unidade válida para cada alimento.')
    changes.push(item)
  }
  const kept = new Set(drafts.map(item => item.id))
  for (const original of originalItems) {
    if (!kept.has(original.id)) {
      const updatedAt = nextMealUpdate(original.updatedAt)
      changes.push({ ...original, revision: original.revision + 1, updatedAt, deletedAt: updatedAt })
    }
  }
  await db.transaction('rw', [db.meals, db.mealItems, db.foods], async () => {
    const currentMeal = await db.meals.get(meal.id)
    const currentItems = (await db.mealItems.where('mealId').equals(meal.id).toArray()).filter(item => !item.deletedAt)
    if ((expectedMeal ? !sameRecord(currentMeal, expectedMeal) : currentMeal !== undefined) || !sameRecord(sorted(currentItems), sorted(originalItems))) throw new MealFormError('Esta refeição foi alterada em outra abertura. Reabra o registro antes de salvar; suas alterações não foram gravadas.')
    for (const food of foods) {
      if (await db.foods.get(food.id)) throw new MealFormError('O cadastro do alimento mudou. Selecione novamente o alimento antes de salvar.')
      await saveFood(food)
    }
    // Refeições legadas sem itens conservam a compatibilidade de IDs e horários antigos.
    if (expectedMeal && !originalItems.length && !drafts.length) await db.meals.put(meal)
    else await saveMealWithItems(meal, changes, expectedMeal)
  })
}

export async function deleteMealIfUnreferenced(mealId: string) {
  // Inclua todas as dependências na transação para serializar também suas escritas.
  return db.transaction('rw', [db.meals, db.mealItems, db.glucose, db.insulin], async () => {
    const [items, glucose, insulin] = await Promise.all([
      db.mealItems.where('mealId').equals(mealId).count(), // Inclusive exclusões lógicas.
      db.glucose.where('mealId').equals(mealId).count(),
      db.insulin.where('mealId').equals(mealId).count(),
    ])
    const dependencies = [
      { count: items, label: 'alimentos registrados no histórico', message: 'Esta refeição possui alimentos registrados no histórico e não pode ser excluída.' },
      { count: glucose, label: 'medições de glicemia vinculadas', message: 'Esta refeição está associada a uma ou mais medições de glicemia e não pode ser excluída.' },
      { count: insulin, label: 'registros de insulina vinculados', message: 'Esta refeição está associada a registros de insulina e não pode ser excluída.' },
    ].filter(dependency => dependency.count > 0)
    if (dependencies.length) throw new MealFormError(dependencies.length === 1 ? dependencies[0].message : `Esta refeição possui múltiplas dependências: ${dependencies.map(dependency => dependency.label).join(', ')}. Não pode ser excluída.`)
    await db.meals.delete(mealId)
  })
}
