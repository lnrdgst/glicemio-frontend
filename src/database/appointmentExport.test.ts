import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, stamp, type Food, type MealItem } from './db'
import { exportBackup, previewBackup, restoreBackup } from './backup'
import { exportSinceEndocrinology, sliceAppointmentExport } from './appointmentExport'

const local = (day: number, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()
beforeEach(async () => { expect(db.name).toBe('glicoponto-tests'); await Promise.all(db.tables.map(table => table.clear())); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(local(28, 15)) })
afterEach(() => vi.useRealTimers())
const addReference = async (day = 27) => { const reference = stamp({ at: local(day, 14), attendanceType: 'endocrinologist' as const, attendanceConfirmed: true }); await db.appointments.add(reference); return reference }

it('usa meia-noite local e o instante da geração, inclui limites e preserva o snapshot local', async () => {
  const reference = await addReference()
  const records = [-1, 0, 1].map(offset => stamp({ at: new Date(Date.parse(local(27)) + offset).toISOString(), value: 100 }))
  const upper = stamp({ at: local(28, 15), value: 110 }), future = stamp({ at: new Date(Date.parse(local(28, 15)) + 1).toISOString(), value: 120 })
  await db.glucose.bulkAdd([...records, upper, future]); const before = await exportBackup()
  const result = await exportSinceEndocrinology()
  expect(result.from).toBe(new Date(2026, 9, 27).getTime()); expect(result.to).toBe(Date.now())
  expect(result.reference).toEqual(reference)
  expect(result.backup.data.glucose).toEqual(expect.arrayContaining([records[1], records[2], upper]))
  expect(result.backup.data.glucose).toHaveLength(3)
  expect((await exportBackup()).data).toEqual(before.data)
})

it('inclui pais fora do período, itens removidos, alimentos arquivados e durações sobrepostas; restaura em base vazia', async () => {
  await addReference()
  const meal = stamp({ at: local(26, 23), kind: 'Jantar' }), episode = stamp({ startedAt: local(24), endedAt: local(25), symptoms: ['Suor'] })
  const catalog: Food = { ...stamp({ name: 'Nome atual', revision: 3, deletedAt: local(26) }), createdAt: local(20), updatedAt: local(26) }
  const item: MealItem = { ...stamp({ mealId: meal.id, foodId: catalog.id, foodName: 'Nome histórico', quantity: '0.000001', unit: 'portion', revision: 2, deletedAt: local(26) }), createdAt: local(20), updatedAt: local(26) }
  await db.profiles.put({ id: 'local', name: 'Sintético', createdAt: local(20), updatedAt: local(20) })
  await db.meals.add(meal); await db.episodes.add(episode); await db.foods.add(catalog); await db.mealItems.add(item)
  await db.glucose.add(stamp({ at: local(27, 1), value: 120, mealId: meal.id, episodeId: episode.id }))
  await db.insulin.add(stamp({ at: local(27, 2), kind: 'Rápida', dose: 2, mealId: meal.id }))
  const crossing = stamp({ startedAt: local(26, 23), endedAt: local(27), activity: 'Caminhada', source: 'preservar' })
  const open = stamp({ startedAt: local(26), activity: 'Sem término' }), endedBefore = stamp({ startedAt: local(25), endedAt: local(26), activity: 'Anterior' })
  await db.workouts.bulkAdd([crossing, open, endedBefore])
  const openEpisode = stamp({ startedAt: local(26), symptoms: [] }); await db.episodes.add(openEpisode)
  const before = await exportBackup(), result = await exportSinceEndocrinology()
  expect(result.backup.data.meals).toEqual([meal]); expect(result.backup.data.mealItems).toEqual([item]); expect(result.backup.data.foods).toEqual([catalog])
  expect(result.backup.data.episodes).toEqual(expect.arrayContaining([episode, openEpisode]))
  expect(result.backup.data.workouts).toEqual(expect.arrayContaining([crossing, open])); expect(result.backup.data.workouts).toHaveLength(2)
  expect((await exportBackup()).data).toEqual(before.data)
  await Promise.all(db.tables.map(table => table.clear()))
  const preview = await previewBackup(JSON.stringify(result.backup)); expect(preview.relationshipErrors).toEqual([])
  await restoreBackup(preview, 'restore'); expect((await exportBackup()).data).toEqual(result.backup.data)
})

it('bloqueia órfãos, refeições excluídas referenciadas e intervalos inválidos sem alterar a base', async () => {
  await addReference(); await db.glucose.add(stamp({ at: local(27, 1), value: 100, mealId: 'ausente' }))
  const before = await exportBackup(); await expect(exportSinceEndocrinology()).rejects.toThrow(/inexistente/)
  expect((await exportBackup()).data).toEqual(before.data)
  await db.glucose.clear()
  const meal = { ...stamp({ at: local(26), kind: 'Jantar', deletedAt: local(27) }), createdAt: local(25), updatedAt: local(27) }; await db.meals.add(meal)
  await db.glucose.add(stamp({ at: local(27, 1), value: 100, mealId: meal.id }))
  await expect(exportSinceEndocrinology()).rejects.toThrow(/excluída/)
  await db.glucose.clear(); await db.workouts.add(stamp({ startedAt: local(27, 2), endedAt: local(27, 1), activity: 'Inválido' }))
  await expect(exportSinceEndocrinology()).rejects.toThrow(/intervalo inválido/)
})

it('permite escolher outra endocrinológica e revalida a escolha sem recorrer a outras especialidades', async () => {
  const older = await addReference(20), recent = await addReference()
  await db.appointments.add(stamp({ at: local(28, 12), attendanceType: 'ophthalmologist', attendanceConfirmed: true }))
  expect((await exportSinceEndocrinology()).reference.id).toBe(recent.id)
  expect((await exportSinceEndocrinology(older)).reference.id).toBe(older.id)
  await db.appointments.update(older.id, { attendanceConfirmed: false })
  await expect(exportSinceEndocrinology(older)).rejects.toThrow(/Revise/)
  await db.appointments.update(recent.id, { at: local(29) })
  await expect(exportSinceEndocrinology()).rejects.toThrow(/Nenhuma consulta com o endocrinologista/)
})

it('não conta perfil ou consultas como registros clínicos e não altera o backup completo', async () => {
  await addReference(); const full = await exportBackup(), result = await exportSinceEndocrinology()
  expect(result.clinicalCount).toBe(0); expect(result.backup.version).toBe(2)
  expect(Object.keys(result.backup.data)).toHaveLength(9)
  expect((await exportBackup()).data).toEqual(full.data)
  const snapshot = { ...full, exportedAt: '2026-10-28T15:00:00-03:00' }
  expect(sliceAppointmentExport(snapshot).to).toBe(Date.parse(snapshot.exportedAt))
})
