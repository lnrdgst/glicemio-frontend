import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, mealItemUnits, now, stamp, type Food, type MealItem } from './db'
import { backupTables, exportBackup, parseBackup, previewBackup, restoreBackup, type BackupData } from './backup'

const at = '2026-10-23T12:34:56.123456-03:00'
const food = (): Food => ({ ...stamp({ name: 'Nome atual', revision: 2, deletedAt: at }), createdAt: at, updatedAt: at })
const item = (mealId: string, foodId?: string): MealItem => ({ ...stamp({ mealId, foodId, foodName: 'Nome histórico consumido', quantity: '999999999999.999999', unit: 'tbsp' as const, revision: 1 }), createdAt: at, updatedAt: at })
const snapshot = async () => (await exportBackup()).data
const clear = async () => { expect(db.name).toBe('glicoponto-tests'); await Promise.all(db.tables.map(table => table.clear())) }
beforeEach(clear)
afterEach(() => vi.restoreAllMocks())

async function seed() {
  const meal = stamp({ kind: 'Almoço', at, description: 'Descrição antiga não estruturada' })
  const catalog = food(), consumed = item(meal.id, catalog.id), free = { ...item(meal.id), quantity: '0.000001', unit: 'portion' as const }
  const episode = stamp({ startedAt: at, symptoms: ['Suor'] })
  await db.profiles.put({ id: 'local', name: 'Sintético', createdAt: at, updatedAt: at })
  await db.meals.add(meal); await db.foods.add(catalog); await db.mealItems.bulkAdd([consumed, free])
  await db.episodes.add(episode)
  await db.glucose.add(stamp({ at, value: 123, mealId: meal.id, episodeId: episode.id }))
  await db.insulin.add(stamp({ at, kind: 'Rápida' as const, dose: 2, mealId: meal.id }))
  await db.workouts.add(stamp({ activity: 'Caminhada', startedAt: at, extra: 'Preservar campo legado' }))
  await db.appointments.add(stamp({ at, professional: 'Sintético' }))
  return { meal, catalog, consumed }
}

it('exporta e restaura as nove coleções v2 integralmente, inclusive decimais e nomes históricos', async () => {
  await seed(); const backup = await exportBackup()
  expect(backup.version).toBe(2); expect(Object.keys(backup.data)).toHaveLength(9)
  await clear()
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.sourceVersion).toBe(2); expect(preview.relationshipErrors).toEqual([])
  const counts = await restoreBackup(preview, 'restore')
  expect(counts.mealItems).toBe(2); expect(counts.foods).toBe(1)
  expect(await snapshot()).toEqual(backup.data)
  const repeat = await previewBackup(JSON.stringify(backup))
  expect(repeat.duplicates.mealItems).toBe(2); expect(repeat.duplicates.foods).toBe(1)
  await restoreBackup(repeat, 'keep')
  expect(await snapshot()).toEqual(backup.data)
})

it('restaura v2 anterior com todas as unidades antigas junto de fatias locais sem regravar registros', async () => {
  const meal = stamp({ kind: 'Lanche', at })
  const consumed = { ...item(meal.id), unit: 'slice' as const, quantity: '1.000000' }
  await db.meals.add(meal); await db.mealItems.add(consumed)
  const oldBackup = await exportBackup()
  oldBackup.data.meals = [stamp({ kind: 'Almoço', at })]
  oldBackup.data.mealItems = mealItemUnits.filter(unit => unit !== 'slice').map(unit => ({ ...item(oldBackup.data.meals[0].id), unit }))
  const oldData = structuredClone(oldBackup.data)
  const preview = await previewBackup(JSON.stringify(oldBackup))
  expect(preview.relationshipErrors).toEqual([])
  expect((await restoreBackup(preview, 'keep')).mealItems).toBe(10)
  expect(await db.meals.get(meal.id)).toEqual(meal)
  expect(await db.mealItems.get(consumed.id)).toEqual(consumed)
  for (const record of oldData.mealItems) expect(await db.mealItems.get(record.id)).toEqual(record)
  expect(oldBackup.data).toEqual(oldData)
})

it('preserva fatias removidas e nomes históricos na exportação e restauração v2', async () => {
  const { meal, catalog } = await seed()
  const consumed = { ...item(meal.id, catalog.id), unit: 'slice' as const, quantity: '0.000001', revision: 3, deletedAt: at }
  await db.mealItems.add(consumed)
  const backup = await exportBackup()
  await clear()
  await restoreBackup(await previewBackup(JSON.stringify(backup)), 'restore')
  expect(await snapshot()).toEqual(backup.data)
  expect(await db.mealItems.get(consumed.id)).toEqual(consumed)
})

it.each(['legacy', 1] as const)('importa backup %s sem novas coleções e sem converter descrições ou IDs antigos', async version => {
  await seed(); const original = await exportBackup()
  const data = Object.fromEntries(backupTables.filter(table => table !== 'foods' && table !== 'mealItems').map(table => [table, original.data[table]])) as Omit<BackupData, 'foods' | 'mealItems'>
  // UUIDs clínicos legados continuam opacos, sem renomear ou regenerar.
  const legacyMeal = { ...stamp({ kind: 'Lanche', at, description: '2 pães e leite' }), id: 'identificador-legado' }
  data.meals.push(legacyMeal)
  const source = version === 'legacy' ? data : { format: original.format, version: 1, exportedAt: original.exportedAt, data }
  await clear()
  const preview = await previewBackup(JSON.stringify(source))
  expect(preview.sourceVersion).toBe(version)
  expect(preview.data.foods).toEqual([]); expect(preview.data.mealItems).toEqual([])
  await restoreBackup(preview, 'restore')
  for (const [table, records] of Object.entries(data)) expect(await db.table(table).toArray()).toEqual([...records].sort((a, b) => a.id.localeCompare(b.id)))
  expect(await db.foods.count()).toBe(0); expect(await db.mealItems.count()).toBe(0)
  expect(await db.meals.get(legacyMeal.id)).toEqual(legacyMeal)
})

it('exige as novas coleções no v2 e rejeita versões futuras sem nenhuma escrita', async () => {
  const backup = await exportBackup(), before = backup.data
  for (const table of ['foods', 'mealItems']) {
    const incomplete = structuredClone(backup); delete (incomplete.data as Record<string, unknown>)[table]
    await expect(previewBackup(JSON.stringify(incomplete))).rejects.toThrow(/ausente/)
  }
  await expect(previewBackup(JSON.stringify({ ...backup, version: 3 }))).rejects.toThrow(/não é suportada/)
  expect(await snapshot()).toEqual(before)
})

it.each([
  { quantity: 1.5 }, { quantity: '0' }, { quantity: '0.0000001' }, { unit: 'ml' }, { unit: 'Slice' }, { unit: 'fatia' },
  { id: 'sem-uuid' }, { foodId: 'sem-uuid' }, { mealId: 'sem-uuid' }, { foodName: ' ' }, { revision: 0 },
])('rejeita item inválido no backup: %j', async update => {
  const backup = await exportBackup()
  backup.data.mealItems.push({ ...item(stamp({}).id), ...update } as MealItem)
  await expect(previewBackup(JSON.stringify(backup))).rejects.toThrow(/registros inválidos/)
  expect(await db.mealItems.count()).toBe(0)
})

it('rejeita alimento inválido e UUIDs duplicados no arquivo', async () => {
  const backup = await exportBackup(), catalog = food()
  backup.data.foods = [{ ...catalog, name: '' }]
  await expect(previewBackup(JSON.stringify(backup))).rejects.toThrow(/registros inválidos/)
  backup.data.foods = [catalog, catalog]
  await expect(previewBackup(JSON.stringify(backup))).rejects.toThrow(/IDs duplicados/)
})

it('valida os dois vínculos dos itens e aceita referências a pais já existentes no dispositivo', async () => {
  const backup = await exportBackup(), meal = stamp({ kind: 'Lanche', at }), catalog = food()
  backup.data.mealItems.push(item(meal.id, catalog.id))
  const invalid = await previewBackup(JSON.stringify(backup))
  expect(invalid.relationshipErrors).toHaveLength(2)
  await expect(restoreBackup(invalid, 'keep')).rejects.toThrow(/referências inválidas/)
  await db.meals.add(meal); await db.foods.add(catalog)
  const valid = await previewBackup(JSON.stringify(backup))
  expect(valid.relationshipErrors).toEqual([])
  await restoreBackup(valid, 'keep')
  expect(await db.mealItems.count()).toBe(1)
})

it.each(['foods', 'mealItems'] as const)('bloqueia conflitos de %s sem sobrescrever nem importar outras tabelas', async table => {
  await seed(); const backup = await exportBackup(), before = backup.data
  if (table === 'foods') backup.data.foods[0].name = 'Nome conflitante'
  else backup.data.mealItems[0].quantity = '2'
  backup.data.glucose.push(stamp({ at, value: 99 }))
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.conflicts[table]).toBe(1)
  const unchanged = await snapshot()
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/Conflito em alimentos ou itens/)
  expect(await snapshot()).toEqual(unchanged)
  expect(before.meals).toEqual(unchanged.meals)
})

it('não associa silenciosamente itens a uma refeição conflitante do mesmo UUID', async () => {
  const { meal } = await seed(), backup = await exportBackup()
  backup.data.meals[0] = { ...meal, at: '2026-10-22T10:00:00-03:00' }
  const preview = await previewBackup(JSON.stringify(backup)), before = await snapshot()
  expect(preview.relationshipErrors.join(' ')).toMatch(/refeições em conflito/)
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/referências inválidas/)
  expect(await snapshot()).toEqual(before)
})

it('revalida referências dentro da transação se um pai desaparecer após a prévia', async () => {
  const meal = stamp({ kind: 'Lanche', at }); await db.meals.add(meal)
  const backup = await exportBackup(); backup.data.meals = []; backup.data.mealItems.push(item(meal.id))
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.relationshipErrors).toEqual([])
  await db.meals.delete(meal.id)
  const before = await snapshot()
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/referências inválidas/)
  expect(await snapshot()).toEqual(before)
})

it('detecta colisão concorrente depois da prévia e rejeita prévia adulterada', async () => {
  const backup = await exportBackup(), catalog = food(); backup.data.foods.push(catalog)
  const preview = await previewBackup(JSON.stringify(backup))
  await db.foods.add({ ...catalog, name: 'Criado depois da prévia' })
  const before = await snapshot()
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/Conflito/)
  preview.data.foods[0].name = ''
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/registros inválidos/)
  expect(await snapshot()).toEqual(before)
})

it('trata ordem diferente das propriedades como duplicata e não como conflito', async () => {
  await seed(); const backup = await exportBackup()
  backup.data.foods[0] = Object.fromEntries(Object.entries(backup.data.foods[0]).reverse()) as Food
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.duplicates.foods).toBe(1); expect(preview.conflicts.foods).toBe(0)
})

it.each(['legacy', 1, 2] as const)('faz rollback completo e do perfil ao falhar restauração %s', async version => {
  await seed(); const backup = await exportBackup(); await clear()
  await db.profiles.add({ id: 'local', name: 'Manter após falha', createdAt: now(), updatedAt: now() })
  const oldData = Object.fromEntries(backupTables.filter(table => table !== 'foods' && table !== 'mealItems').map(table => [table, backup.data[table]]))
  const source = version === 'legacy' ? oldData : version === 1 ? { ...backup, version: 1, data: oldData } : backup
  const before = await snapshot(), preview = await previewBackup(JSON.stringify(source))
  if (version === 2) vi.spyOn(db.mealItems, 'bulkAdd').mockRejectedValueOnce(new Error('Falha sintética final'))
  else vi.spyOn(db.appointments, 'bulkAdd').mockRejectedValueOnce(new Error('Falha sintética final'))
  await expect(restoreBackup(preview, 'restore')).rejects.toThrow('Falha sintética final')
  expect(await snapshot()).toEqual(before)
})

it('restaurar um v1 vazio não limpa catálogo nem itens já existentes', async () => {
  const empty = await exportBackup()
  const data = Object.fromEntries(backupTables.filter(table => table !== 'foods' && table !== 'mealItems').map(table => [table, empty.data[table]]))
  await seed(); const before = await snapshot()
  const preview = await previewBackup(JSON.stringify({ ...empty, version: 1, data }))
  await restoreBackup(preview, 'keep')
  expect(await snapshot()).toEqual(before)
})

it('não descarta coleções novas presentes no JSON sem envelope usado na conferência da classificação', async () => {
  await seed(); const data = await snapshot()
  expect(parseBackup(JSON.stringify(data)).data).toEqual(data)
})
