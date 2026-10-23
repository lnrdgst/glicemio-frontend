import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, stamp } from './db'
import { backupIntegrityErrors, exportBackup, previewBackup, restoreBackup } from './backup'
import { deleteMeal, mealDeletionBlockReason } from './mealForm'

const at = '2026-10-23T12:34:56.123456-03:00'
const snapshot = async () => (await exportBackup()).data
const clear = async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
}
beforeEach(clear)
afterEach(() => vi.restoreAllMocks())

type Dependencies = { items?: 'active' | 'deleted'; glucose?: boolean; insulin?: boolean }
async function seed(dependencies: Dependencies = {}) {
  const meal = stamp({ kind: 'Almoço', at, timeReference: 'meal_end' as const, description: 'Descrição histórica preservada' })
  await db.meals.add(meal)
  if (dependencies.items) {
    const food = stamp({ name: 'Nome atual', revision: 1 })
    await db.foods.add(food)
    await db.mealItems.add({ ...stamp({ mealId: meal.id, foodId: food.id, foodName: 'Nome consumido', quantity: '999999999999.999999', unit: 'cup' as const, revision: dependencies.items === 'deleted' ? 2 : 1, ...(dependencies.items === 'deleted' ? { deletedAt: at } : {}) }), createdAt: at, updatedAt: at })
  }
  if (dependencies.glucose) await db.glucose.add(stamp({ at, value: 123, mealId: meal.id }))
  if (dependencies.insulin) await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 1.5, mealId: meal.id }))
  return meal
}

it.each([
  { glucose: true, message: 'uma ou mais medições de glicemia' },
  { insulin: true, message: 'registros de insulina' },
  { glucose: true, insulin: true, message: 'medições de glicemia e registros de insulina' },
  { items: 'active' as const, glucose: true, insulin: true, message: 'medições de glicemia e registros de insulina' },
  { items: 'deleted' as const, glucose: true, message: 'uma ou mais medições de glicemia' },
])('bloqueia vínculos clínicos sem alterar nenhuma coleção: %j', async dependencies => {
  const meal = await seed(dependencies), before = await snapshot()
  expect(await mealDeletionBlockReason(meal.id)).toContain(dependencies.message)
  await expect(deleteMeal(meal.id)).rejects.toThrow(dependencies.message)
  expect(await snapshot()).toEqual(before)
  expect(backupIntegrityErrors(await snapshot())).toEqual([])
})

it.each([undefined, 'active', 'deleted'] as const)('exclui logicamente refeição e consumos com itens=%s e preserva catálogo e outros registros', async items => {
  await seed({ items: 'active', glucose: true, insulin: true })
  const meal = await seed({ items }), before = await snapshot()
  await deleteMeal(meal.id)
  const after = await snapshot(), deleted = after.meals.find(record => record.id === meal.id)!
  expect(deleted.deletedAt).toBeTruthy()
  expect(Date.parse(deleted.updatedAt)).toBeGreaterThan(Date.parse(meal.updatedAt))
  expect(deleted).toEqual({ ...meal, updatedAt: deleted.deletedAt, deletedAt: deleted.deletedAt })
  const expectedItems = before.mealItems.map(item => item.mealId === meal.id && !item.deletedAt ? { ...item, updatedAt: deleted.deletedAt, deletedAt: deleted.deletedAt, revision: item.revision + 1 } : item)
  expect(after).toEqual({ ...before, meals: before.meals.map(record => record.id === meal.id ? deleted : record), mealItems: expectedItems })
  expect(backupIntegrityErrors(after)).toEqual([])
  await deleteMeal(meal.id)
  expect(await snapshot()).toEqual(after) // Idempotência, inclusive metadados.
})

it.each(['meal', 'items'] as const)('reverte todas as escritas após falha em %s', async stage => {
  const meal = await seed({ items: 'active' }), before = await snapshot()
  if (stage === 'meal') {
    const put = db.meals.put.bind(db.meals)
    vi.spyOn(db.meals, 'put').mockImplementationOnce(record => put(record).then(() => { throw new Error('Falha após escrita') }))
  } else {
    const put = db.mealItems.bulkPut.bind(db.mealItems)
    vi.spyOn(db.mealItems, 'bulkPut').mockImplementationOnce(records => put(records).then(() => { throw new Error('Falha após escrita') }))
  }
  await expect(deleteMeal(meal.id)).rejects.toThrow('Falha após escrita')
  expect(await snapshot()).toEqual(before)
})

it('não exclui quando não consegue verificar uma dependência', async () => {
  const meal = await seed(), before = await snapshot()
  vi.spyOn(db.insulin, 'where').mockImplementationOnce(() => { throw new Error('Falha de leitura') })
  await expect(deleteMeal(meal.id)).rejects.toThrow('Falha de leitura')
  expect(await snapshot()).toEqual(before)
})

it('não grava revisão que exceda a precisão inteira suportada pelo backup', async () => {
  const meal = await seed({ items: 'active' }), item = (await db.mealItems.toArray())[0]
  await db.mealItems.update(item.id, { revision: Number.MAX_SAFE_INTEGER })
  const before = await snapshot()
  await expect(deleteMeal(meal.id)).rejects.toThrow('metadados inválidos')
  expect(await snapshot()).toEqual(before)
})

it.each(['glucose', 'insulin'] as const)('aguarda gravação concorrente em %s e bloqueia a exclusão', async table => {
  const meal = await seed()
  let deletion!: Promise<void>
  await db.transaction('rw', db[table], async () => {
    if (table === 'glucose') await db.glucose.add(stamp({ at, value: 123, mealId: meal.id }))
    else await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 1, mealId: meal.id }))
    deletion = Dexie.ignoreTransaction(() => deleteMeal(meal.id))
    void deletion.catch(() => {})
  })
  const before = await snapshot()
  await expect(deletion).rejects.toThrow(table === 'glucose' ? 'medições de glicemia' : 'registros de insulina')
  expect(await snapshot()).toEqual(before)
})

it('revalida um vínculo criado depois da prévia de exclusão', async () => {
  const meal = await seed({ items: 'active' })
  expect(await mealDeletionBlockReason(meal.id)).toBeUndefined()
  await db.glucose.add(stamp({ at, value: 123, mealId: meal.id }))
  const before = await snapshot()
  await expect(deleteMeal(meal.id)).rejects.toThrow('medições de glicemia')
  expect(await snapshot()).toEqual(before)
})

it('exporta e restaura v2 com refeições excluídas, itens ativos e já removidos, sem perder catálogo', async () => {
  await seed({ items: 'active', glucose: true, insulin: true })
  const first = await seed({ items: 'active' }), second = await seed({ items: 'deleted' })
  await deleteMeal(first.id); await deleteMeal(second.id)
  const backup = await exportBackup()
  expect(backup.version).toBe(2); expect(backupIntegrityErrors(backup.data)).toEqual([])
  await clear()
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.relationshipErrors).toEqual([])
  await restoreBackup(preview, 'restore')
  expect(await snapshot()).toEqual(backup.data)
  expect((await db.meals.get(first.id))?.deletedAt).toBeTruthy()
  expect(await db.foods.count()).toBe(3)
})

it('backup antigo não ressuscita refeição já excluída', async () => {
  const meal = await seed(), old = await exportBackup()
  await deleteMeal(meal.id)
  const before = await snapshot(), preview = await previewBackup(JSON.stringify(old))
  expect(preview.conflicts.meals).toBe(1)
  await restoreBackup(preview, 'keep')
  expect(await snapshot()).toEqual(before)
})

it.each(['invalid', '2020-01-01T00:00:00Z', '9999-01-01T00:00:00Z'])('rejeita deletedAt inválido ou fora dos metadados: %s', async deletedAt => {
  await seed()
  const backup = await exportBackup(); backup.data.meals[0].deletedAt = deletedAt
  await expect(previewBackup(JSON.stringify(backup))).rejects.toThrow('meals')
})

it('rejeita consumo ativo ou registro clínico apontando para refeição excluída', async () => {
  const meal = await seed({ items: 'active' })
  await deleteMeal(meal.id)
  const backup = await exportBackup()
  delete backup.data.mealItems[0].deletedAt
  expect((await previewBackup(JSON.stringify(backup))).relationshipErrors.join()).toContain('Item ativo')
  backup.data.mealItems[0].deletedAt = backup.data.meals[0].deletedAt
  backup.data.glucose.push(stamp({ at, value: 123, mealId: meal.id }))
  expect((await previewBackup(JSON.stringify(backup))).relationshipErrors.join()).toContain('Registro clínico')
})

it('não modifica referências órfãs preexistentes ao excluir outra refeição', async () => {
  const meal = await seed(), missingId = stamp({}).id
  await db.glucose.add(stamp({ at, value: 123, mealId: missingId }))
  await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 1, mealId: missingId }))
  const before = await snapshot()
  await deleteMeal(meal.id)
  const deleted = (await db.meals.get(meal.id))!
  expect(await snapshot()).toEqual({ ...before, meals: [deleted] })
})
