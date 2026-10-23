import { db, id, mealItemUnits, stamp, type Food, type Meal, type MealItem, type MealItemUnit } from './db'
import { isMealItem, isMealQuantity, sameRecord, saveFood, saveMealWithItems } from './structuredMeals'

export type MealItemDraft = { id: string; foodName: string; quantity: string; unit: MealItemUnit | ''; foodId?: string }
export class MealFormError extends Error {}
export const emptyMealItem = (): MealItemDraft => ({ id: id(), foodName: '', quantity: '', unit: '' })
export const draftFromMealItem = (item: MealItem): MealItemDraft => ({ id: item.id, foodName: item.foodName, quantity: item.quantity, unit: item.unit, foodId: item.foodId })
export const nextMealUpdate = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString()
const sorted = (items: MealItem[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))
// Correspondência automática exata: caixa/espaços equivalentes, acentos preservados.
export const exactFoodName = (name: string) => name.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('pt-BR')

/** Catálogo, refeição e consumos são resolvidos e gravados na mesma transação. */
export async function saveMealForm(meal: Meal, drafts: MealItemDraft[], originalItems: MealItem[], expectedMeal?: Meal) {
  meal = structuredClone(meal); drafts = structuredClone(drafts); originalItems = structuredClone(originalItems); expectedMeal = structuredClone(expectedMeal)
  if (new Set(drafts.map(item => item.id)).size !== drafts.length) throw new MealFormError('Há itens duplicados nesta refeição.')
  const originals = new Map(originalItems.map(item => [item.id, item]))
  const validated = drafts.map(draft => {
    const foodName = originals.get(draft.id)?.foodName === draft.foodName ? draft.foodName : draft.foodName.trim()
    const quantity = draft.quantity.trim().replace(',', '.').replace(/^0+(?=\d)/, '')
    if (!foodName || foodName.length > 200) throw new MealFormError('Informe o nome de cada alimento, com até 200 caracteres.')
    if (!isMealQuantity(quantity)) throw new MealFormError('Informe uma quantidade maior que zero, com até 12 dígitos inteiros e 6 casas decimais. Nenhum valor será arredondado.')
    if (!mealItemUnits.includes(draft.unit as MealItemUnit)) throw new MealFormError('Selecione uma unidade válida para cada alimento.')
    return { ...draft, foodName, quantity }
  })
  await db.transaction('rw', [db.meals, db.mealItems, db.foods], async () => {
    const currentMeal = await db.meals.get(meal.id)
    const currentItems = (await db.mealItems.where('mealId').equals(meal.id).toArray()).filter(item => !item.deletedAt)
    if (meal.deletedAt || currentMeal?.deletedAt || (expectedMeal ? !sameRecord(currentMeal, expectedMeal) : currentMeal !== undefined) || !sameRecord(sorted(currentItems), sorted(originalItems))) throw new MealFormError('Esta refeição foi alterada em outra abertura. Reabra o registro antes de salvar; suas alterações não foram gravadas.')
    const catalog = await db.foods.filter(food => !food.deletedAt).toArray()
    const changes: MealItem[] = []
    for (const draft of validated) {
      const original = originals.get(draft.id)
      let foodId = draft.foodId
      // Um consumo histórico sem catálogo continua sem vínculo ao corrigir só sua quantidade.
      if (!foodId && !(original && original.foodName === draft.foodName && !original.foodId)) {
        const matches = catalog.filter(food => exactFoodName(food.name) === exactFoodName(draft.foodName))
        if (matches.length > 1) throw new MealFormError(`Há mais de um alimento com o nome “${draft.foodName}”. Selecione uma sugestão do catálogo antes de salvar.`)
        if (matches.length === 1) foodId = matches[0].id
        else {
          const food: Food = stamp({ name: draft.foodName, revision: 1 })
          await saveFood(food)
          catalog.push(food); foodId = food.id
        }
      }
      const business = { mealId: meal.id, foodName: draft.foodName, quantity: draft.quantity, unit: draft.unit, foodId }
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
    // Refeições legadas sem itens conservam IDs e horários antigos.
    if (expectedMeal && !originalItems.length && !drafts.length) await db.meals.put(meal)
    else await saveMealWithItems(meal, changes, expectedMeal)
  })
}

/** Prévia de UX; a operação final repete esta verificação sob a transação de escrita. */
export async function mealDeletionBlockReason(mealId: string) {
  const [glucose, insulin] = await Promise.all([
    db.glucose.where('mealId').equals(mealId).count(),
    db.insulin.where('mealId').equals(mealId).count(),
  ])
  if (glucose && insulin) return 'Esta refeição está associada a medições de glicemia e registros de insulina e não pode ser excluída.'
  if (glucose) return 'Esta refeição está associada a uma ou mais medições de glicemia e não pode ser excluída.'
  if (insulin) return 'Esta refeição está associada a registros de insulina e não pode ser excluída.'
}

export async function deleteMeal(mealId: string) {
  return db.transaction('rw', [db.meals, db.mealItems, db.glucose, db.insulin], async () => {
    const reason = await mealDeletionBlockReason(mealId)
    if (reason) throw new MealFormError(reason)
    const meal = await db.meals.get(mealId)
    if (!meal || meal.deletedAt) return // Repetir a exclusão não regrava o histórico.
    const items = await db.mealItems.where('mealId').equals(mealId).filter(item => !item.deletedAt).toArray()
    const updatedAt = nextMealUpdate([meal.updatedAt, ...items.map(item => item.updatedAt)].sort((a, b) => Date.parse(b) - Date.parse(a))[0])
    const changes = items.map(item => ({ ...item, revision: item.revision + 1, updatedAt, deletedAt: updatedAt }))
    if (!changes.every(isMealItem)) throw new MealFormError('Não foi possível excluir esta refeição com segurança: há itens com metadados inválidos. Nenhum registro foi alterado.')
    await db.meals.put({ ...meal, updatedAt, deletedAt: updatedAt })
    if (changes.length) await db.mealItems.bulkPut(changes)
  })
}
