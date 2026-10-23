import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, stamp } from './db'
import { backupIntegrityErrors, exportBackup, previewBackup, restoreBackup } from './backup'
import { deleteMealIfUnreferenced } from './mealForm'

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

const itemMessage = 'Esta refeição possui alimentos registrados no histórico e não pode ser excluída.'
const cases: (Dependencies & { label: string; message: string })[] = [
  { label: 'item ativo', items: 'active', message: itemMessage },
  { label: 'somente item removido logicamente', items: 'deleted', message: itemMessage },
  { label: 'glicemia', glucose: true, message: 'Esta refeição está associada a uma ou mais medições de glicemia e não pode ser excluída.' },
  { label: 'insulina', insulin: true, message: 'Esta refeição está associada a registros de insulina e não pode ser excluída.' },
  { label: 'item e glicemia', items: 'active', glucose: true, message: 'Esta refeição possui múltiplas dependências: alimentos registrados no histórico, medições de glicemia vinculadas. Não pode ser excluída.' },
  { label: 'item e insulina', items: 'deleted', insulin: true, message: 'Esta refeição possui múltiplas dependências: alimentos registrados no histórico, registros de insulina vinculados. Não pode ser excluída.' },
  { label: 'glicemia e insulina', glucose: true, insulin: true, message: 'Esta refeição possui múltiplas dependências: medições de glicemia vinculadas, registros de insulina vinculados. Não pode ser excluída.' },
  { label: 'todos os vínculos', items: 'active', glucose: true, insulin: true, message: 'Esta refeição possui múltiplas dependências: alimentos registrados no histórico, medições de glicemia vinculadas, registros de insulina vinculados. Não pode ser excluída.' },
]

it.each(cases)('bloqueia por $label sem alterar nenhuma coleção', async dependencies => {
  await seed({ items: 'deleted', glucose: true, insulin: true }) // Outros vínculos não devem ser alterados.
  const meal = await seed(dependencies), before = await snapshot()
  await expect(deleteMealIfUnreferenced(meal.id)).rejects.toThrow(dependencies.message)
  expect(await snapshot()).toEqual(before)
  expect(backupIntegrityErrors(await snapshot())).toEqual([])
})

it('permite excluir somente a refeição sem dependências, preservando os outros registros', async () => {
  await seed({ items: 'active', glucose: true, insulin: true })
  const meal = await seed(), before = await snapshot()
  await deleteMealIfUnreferenced(meal.id)
  expect(await snapshot()).toEqual({ ...before, meals: before.meals.filter(record => record.id !== meal.id) })
  expect(backupIntegrityErrors(await snapshot())).toEqual([])
})

it('reverte a exclusão já executada se a transação falhar', async () => {
  await seed({ items: 'deleted', glucose: true, insulin: true })
  const meal = await seed(), before = await snapshot(), remove = db.meals.delete.bind(db.meals)
  vi.spyOn(db.meals, 'delete').mockImplementationOnce(key => remove(key).then(() => db.meals.get(key)).then(deleted => {
    expect(deleted).toBeUndefined() // A escrita chegou a ocorrer dentro da transação.
    throw new Error('Falha após exclusão')
  }))
  await expect(deleteMealIfUnreferenced(meal.id)).rejects.toThrow('Falha após exclusão')
  expect(await snapshot()).toEqual(before)
})

it('não exclui quando não consegue verificar uma dependência', async () => {
  const meal = await seed(), before = await snapshot()
  vi.spyOn(db.insulin, 'where').mockImplementationOnce(() => { throw new Error('Falha de leitura') })
  await expect(deleteMealIfUnreferenced(meal.id)).rejects.toThrow('Falha de leitura')
  expect(await snapshot()).toEqual(before)
})

it.each(['glucose', 'insulin'] as const)('aguarda gravação concorrente em %s e bloqueia a exclusão', async table => {
  const meal = await seed()
  let deletion!: Promise<void>
  await db.transaction('rw', db[table], async () => {
    if (table === 'glucose') await db.glucose.add(stamp({ at, value: 123, mealId: meal.id }))
    else await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 1, mealId: meal.id }))
    // Inicia outra transação enquanto o vínculo ainda não foi confirmado.
    deletion = Dexie.ignoreTransaction(() => deleteMealIfUnreferenced(meal.id))
    void deletion.catch(() => {})
  })
  const before = await snapshot()
  await expect(deletion).rejects.toThrow(table === 'glucose' ? 'medições de glicemia' : 'registros de insulina')
  expect(await snapshot()).toEqual(before)
  expect(await db[table].where('mealId').equals(meal.id).count()).toBe(1)
})

it('preserva exportação e restauração v2 após exclusão permitida e bloqueada', async () => {
  const linked = await seed({ items: 'deleted', glucose: true, insulin: true })
  const empty = await seed()
  await expect(deleteMealIfUnreferenced(linked.id)).rejects.toThrow('múltiplas dependências')
  await deleteMealIfUnreferenced(empty.id)
  const backup = await exportBackup()
  expect(backup.version).toBe(2)
  expect(backupIntegrityErrors(backup.data)).toEqual([])
  await clear()
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.relationshipErrors).toEqual([])
  await restoreBackup(preview, 'restore')
  expect(await snapshot()).toEqual(backup.data)
  expect(await db.meals.get(empty.id)).toBeUndefined()
})

it('não modifica referências órfãs preexistentes ao excluir outra refeição', async () => {
  const meal = await seed(), missingId = stamp({}).id
  await db.glucose.add(stamp({ at, value: 123, mealId: missingId }))
  await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 1, mealId: missingId }))
  const before = await snapshot()
  await deleteMealIfUnreferenced(meal.id)
  expect(await snapshot()).toEqual({ ...before, meals: [] })
})
