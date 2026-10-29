import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, mealItemUnits, stamp, type MealItem } from './db'
import { isFood, isMealItem, isMealQuantity, saveFood, saveMealWithItems } from './structuredMeals'

const at = '2026-10-23T12:00:00.123456-03:00', later = '2026-10-23T12:00:00.123457-03:00'
const makeFood = () => ({ ...stamp({ name: 'Arroz sintético', revision: 1 }), createdAt: at, updatedAt: at })
const makeMeal = () => ({ ...stamp({ kind: 'Almoço', at, description: 'Descrição livre preservada', timeReference: 'meal_start' as const }), createdAt: at, updatedAt: at })
const makeItem = (mealId: string, foodId?: string): MealItem => ({ ...stamp({ mealId, foodId, foodName: 'Arroz consumido', quantity: '1.234567', unit: 'cup' as const, revision: 1 }), createdAt: at, updatedAt: at })
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
})
afterEach(() => vi.restoreAllMocks())

describe('contratos locais de alimentos e itens', () => {
  it.each(['0.000001', '0.5', '1', '1.234567', '999999999999.999999'])('preserva o decimal exato %s', quantity => {
    expect(isMealQuantity(quantity)).toBe(true)
    expect(JSON.parse(JSON.stringify({ quantity })).quantity).toBe(quantity)
  })
  it.each([0, 1.25, NaN, Infinity, '', '0', '0.000000', '-1', '1,5', '1e-6', '01.5', '1.0000001', '1000000000000', ' 1', '1.'])('rejeita quantidade fora do contrato: %s', quantity => {
    expect(isMealQuantity(quantity)).toBe(false)
  })
  it.each(mealItemUnits)('aceita a unidade %s sem conversão', unit => {
    const item = { ...makeItem(makeMeal().id), quantity: '2.5', unit }
    expect(isMealItem(item)).toBe(true)
    expect(item.quantity).toBe('2.5')
    expect(item.unit).toBe(unit)
  })
  it.each(['ml', 'G', 'gramas', '', 'bowl', 'Slice', 'slices', 'fatia'])('rejeita código de unidade %s', unit => {
    expect(isMealItem({ ...makeItem(makeMeal().id), unit })).toBe(false)
  })
  it('valida UUIDs apenas dos modelos novos, nomes e metadados de precisão exata', () => {
    const food = makeFood(), item = makeItem(makeMeal().id, food.id)
    expect(isFood(food)).toBe(true); expect(isMealItem(item)).toBe(true)
    for (const field of ['id', 'mealId', 'foodId']) expect(isMealItem({ ...item, [field]: 'id-inválido' })).toBe(false)
    expect(isFood({ ...food, id: 'legado-opaco' })).toBe(false)
    expect(isFood({ ...food, name: ' ' })).toBe(false)
    expect(isFood({ ...food, name: 'a'.repeat(201) })).toBe(false)
    expect(isMealItem({ ...item, foodName: '' })).toBe(false)
    for (const revision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) expect(isFood({ ...food, revision })).toBe(false)
    for (const updatedAt of ['2026-02-30T12:00:00Z', '2026-10-23T12:00:00', '2026-10-23', '2026-10-23T12:00:00.123455-03:00']) expect(isFood({ ...food, updatedAt })).toBe(false)
    expect(isFood({ ...food, deletedAt: later })).toBe(false)
    expect(isFood({ ...food, updatedAt: later, deletedAt: later })).toBe(true)
  })
})

describe('operações locais atômicas, ainda não conectadas aos formulários', () => {
  it('salva múltiplos itens, aceita alimento opcional e preserva quantidades e nomes históricos', async () => {
    const food = makeFood(), meal = makeMeal(), first = makeItem(meal.id, food.id), second = { ...makeItem(meal.id), quantity: '999999999999.999999', unit: 'g' as const }
    await saveFood(food); await saveMealWithItems(meal, [first, second])
    expect(await db.meals.get(meal.id)).toEqual(meal)
    expect(await db.mealItems.get(first.id)).toEqual(first)
    expect(await db.mealItems.get(second.id)).toEqual(second)
    await saveFood({ ...food, name: 'Nome atual diferente', revision: 2, updatedAt: later })
    expect((await db.mealItems.get(first.id))?.foodName).toBe('Arroz consumido')
    // Reutilizar alimento não reutiliza a quantidade nem o UUID do consumo anterior.
    const other = makeMeal(), reused = { ...makeItem(other.id, food.id), quantity: '0.5' }
    await saveMealWithItems(other, [reused])
    expect(await db.mealItems.get(first.id)).toEqual(first)
    expect((await db.mealItems.get(reused.id))?.quantity).toBe('0.5')
  })
  it('faz rollback da refeição quando a gravação dos itens falha', async () => {
    const meal = makeMeal(), item = makeItem(meal.id)
    vi.spyOn(db.mealItems, 'bulkPut').mockRejectedValueOnce(new Error('Falha sintética nos itens'))
    await expect(saveMealWithItems(meal, [item])).rejects.toThrow('Falha sintética')
    expect(await db.meals.count()).toBe(0); expect(await db.mealItems.count()).toBe(0)
  })
  it('bloqueia referências inexistentes, itens duplicados e troca de refeição de item existente', async () => {
    const meal = makeMeal(), food = makeFood(), invalid = makeItem(meal.id, food.id)
    await expect(saveMealWithItems(meal, [invalid])).rejects.toThrow(/indisponível/)
    expect(await db.meals.count()).toBe(0)
    const item = makeItem(meal.id)
    await expect(saveMealWithItems(meal, [item, item])).rejects.toThrow(/inválidos/)
    await expect(saveMealWithItems(meal, [{ ...item, mealId: makeMeal().id }])).rejects.toThrow(/inválidos/)
    await saveMealWithItems(meal, [item])
    const other = makeMeal()
    await expect(saveMealWithItems(other, [{ ...item, mealId: other.id, revision: 2, updatedAt: later }])).rejects.toThrow(/outra refeição/)
    expect(await db.meals.get(other.id)).toBeUndefined()
    expect(await db.mealItems.get(item.id)).toEqual(item)
  })
  it('serializa revisões concorrentes e não sobrescreve uma edição mais recente', async () => {
    const food = makeFood(); await saveFood(food)
    const results = await Promise.allSettled(['A', 'B'].map(name => saveFood({ ...food, name, revision: 2, updatedAt: later })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await db.foods.get(food.id))?.revision).toBe(2)
  })
  it('exige snapshot da refeição e revisão atual dos itens sem remover itens omitidos', async () => {
    const meal = makeMeal(), item = makeItem(meal.id); await saveMealWithItems(meal, [item])
    const edited = { ...meal, description: 'Descrição corrigida', updatedAt: later }
    await expect(saveMealWithItems(edited, [])).rejects.toThrow(/Conflito na refeição/)
    await saveMealWithItems(edited, [], meal)
    expect(await db.mealItems.get(item.id)).toEqual(item)
    await expect(saveMealWithItems({ ...edited, kind: 'Jantar' }, [], meal)).rejects.toThrow(/Conflito na refeição/)
    await expect(saveMealWithItems(edited, [{ ...item, quantity: '2', updatedAt: later }], edited)).rejects.toThrow(/revisão/)
    expect(await db.meals.get(meal.id)).toEqual(edited)
    expect(await db.mealItems.get(item.id)).toEqual(item)
  })
  it('preserva histórico após exclusão lógica e bloqueia novas associações ao alimento excluído', async () => {
    const food = makeFood(), meal = makeMeal(), item = makeItem(meal.id, food.id)
    await saveFood(food); await saveMealWithItems(meal, [item])
    await saveFood({ ...food, deletedAt: later, updatedAt: later, revision: 2 })
    expect(await db.mealItems.get(item.id)).toEqual(item)
    await saveMealWithItems(meal, [{ ...item, quantity: '2', revision: 2, updatedAt: later }], meal)
    const other = makeMeal()
    await expect(saveMealWithItems(other, [makeItem(other.id, food.id)])).rejects.toThrow(/indisponível/)
    expect(await db.meals.get(other.id)).toBeUndefined()
    await expect(saveFood({ ...food, updatedAt: '2026-10-23T12:00:01-03:00', revision: 3 })).rejects.toThrow(/Conflito/)
  })
})
