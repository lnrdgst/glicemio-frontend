import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, stamp } from './db'
import { exportBackup } from './backup'
import { deleteMeal, emptyMealItem, saveMealForm } from './mealForm'

const at = '2026-10-23T08:50:00-03:00'
const meal = () => stamp({ kind: 'Café da manhã', at, timeReference: 'meal_start' as const })
const item = (foodName: string) => ({ ...emptyMealItem(), foodName, quantity: '0,123456', unit: 'cup' as const })
const snapshot = async () => (await exportBackup()).data
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
})
afterEach(() => vi.restoreAllMocks())

it('cria alimentos automaticamente e reutiliza correspondência exata única sem mudar o nome consumido', async () => {
  const food = stamp({ name: 'Arroz integral', revision: 1 })
  await db.foods.add(food)
  await saveMealForm(meal(), [item(' arroz  integral '), item('Feijão')], [])
  const items = await db.mealItems.toArray()
  expect(items.find(record => record.foodId === food.id)).toMatchObject({ foodName: 'arroz  integral', quantity: '0.123456' })
  expect(await db.foods.count()).toBe(2)
  expect(await db.foods.get(food.id)).toEqual(food)
})

it('mantém alimentos semelhantes, sem acento ou arquivados separados', async () => {
  await db.foods.bulkAdd([stamp({ name: 'Maçã', revision: 1 }), stamp({ name: 'Maca peruana', revision: 1 }), stamp({ name: 'Arroz', revision: 2, deletedAt: at })])
  await saveMealForm(meal(), [item('Maca'), item('Arroz')], [])
  expect(await db.foods.count()).toBe(5)
  const items = await db.mealItems.toArray()
  for (const consumed of items) expect((await db.foods.get(consumed.foodId!))?.deletedAt).toBeUndefined()
})

it('duas linhas e dois salvamentos concorrentes não duplicam o mesmo alimento', async () => {
  await Promise.all([
    saveMealForm(meal(), [item('Arroz'), item(' arroz ')], []),
    saveMealForm(meal(), [item('ARROZ')], []),
  ])
  expect(await db.foods.count()).toBe(1)
  const items = await db.mealItems.toArray()
  expect(items).toHaveLength(3); expect(new Set(items.map(record => record.foodId)).size).toBe(1)
})

it('repetir o salvamento da mesma refeição não duplica catálogo ou itens', async () => {
  const record = meal(), drafts = [item('Arroz')]
  const results = await Promise.allSettled([saveMealForm(record, drafts, []), saveMealForm(record, drafts, [])])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(await db.foods.count()).toBe(1); expect(await db.meals.count()).toBe(1); expect(await db.mealItems.count()).toBe(1)
})

it('não adivinha identidade ambígua e aceita escolha explícita da sugestão', async () => {
  const first = stamp({ name: 'Arroz', revision: 1 }), second = stamp({ name: 'arroz', revision: 1 })
  await db.foods.bulkAdd([first, second])
  const record = meal(), draft = item('Arroz'), before = await snapshot()
  await expect(saveMealForm(record, [item('Novo'), draft], [])).rejects.toThrow('Selecione uma sugestão')
  expect(await snapshot()).toEqual(before) // Inclusive o novo catálogo escrito antes da ambiguidade.
  await saveMealForm(record, [{ ...draft, foodId: second.id }], [])
  expect((await db.mealItems.toArray())[0].foodId).toBe(second.id)
  expect(await db.foods.count()).toBe(2)
})

it.each(['quantidade', 'unidade', 'nome'] as const)('não cadastra alimento incompleto por %s inválida', async field => {
  const draft = { ...item('Novo'), ...(field === 'quantidade' ? { quantity: '0' } : field === 'unidade' ? { unit: '' as const } : { foodName: '' }) }
  const before = await snapshot()
  await expect(saveMealForm(meal(), [draft], [])).rejects.toThrow()
  expect(await snapshot()).toEqual(before)
})

it('não ressuscita refeição excluída em formulário aberto antes da exclusão', async () => {
  const record = meal(); await db.meals.add(record)
  await deleteMeal(record.id)
  const before = await snapshot()
  await expect(saveMealForm(record, [item('Novo')], [], record)).rejects.toThrow('Reabra o registro')
  expect(await snapshot()).toEqual(before)
})

it('preserva identidade de item histórico sem catálogo ao editar só quantidade', async () => {
  const record = meal(), consumed = stamp({ mealId: record.id, foodName: 'Legado sem catálogo', quantity: '1', unit: 'unit' as const, revision: 1 })
  await db.meals.add(record); await db.mealItems.add(consumed)
  await saveMealForm(record, [{ ...consumed, quantity: '2' }], [consumed], record)
  expect(await db.foods.count()).toBe(0)
  expect(await db.mealItems.get(consumed.id)).toMatchObject({ foodName: consumed.foodName, quantity: '2', id: consumed.id, createdAt: consumed.createdAt })
  expect((await db.mealItems.get(consumed.id))?.foodId).toBeUndefined()
})
