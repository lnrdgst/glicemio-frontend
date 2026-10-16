import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { db, now, stamp } from './db'
import { exportBackup, previewBackup, restoreBackup } from './backup'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })

it('exporta o formato versionado e restaura um backup legado preservando IDs e vínculos', async () => {
  const meal = stamp({ kind: 'Almoço', at: now() }); const episode = stamp({ startedAt: now(), symptoms: ['Suor'] }); const glucose = stamp({ value: 120, at: now(), mealId: meal.id, episodeId: episode.id })
  const appointment = stamp({ at: now(), attendanceType: 'endocrinologist' as const, professional: 'Dra. Joana' })
  const profile = { id: 'local', name: 'Teste', basalUsage: 'yes' as const, basalMedicationId: 'glargine-u100-basaglar', rapidUsage: 'yes' as const, rapidMedicationId: 'lispro-humalog', createdAt: now(), updatedAt: now() }
  await db.profiles.add(profile); await db.meals.add(meal); await db.episodes.add(episode); await db.glucose.add(glucose); await db.appointments.add(appointment)
  const backup = await exportBackup()
  expect(backup).toMatchObject({ format: 'glicoponto-backup', version: 1 }); expect(backup.data.glucose[0]).toEqual(glucose)
  await Promise.all(db.tables.map(table => table.clear()))
  const preview = await previewBackup(JSON.stringify(backup.data))
  expect(preview.sourceVersion).toBe('legacy'); expect(preview.relationshipErrors).toEqual([])
  await restoreBackup(preview, 'keep')
  expect(await db.glucose.get(glucose.id)).toEqual(glucose); expect(await db.meals.get(meal.id)).toEqual(meal); expect(await db.episodes.get(episode.id)).toEqual(episode); expect(await db.appointments.get(appointment.id)).toEqual(appointment); expect(await db.profiles.get('local')).toEqual(profile)
})

it('não sobrescreve registros existentes e informa conflito na prévia', async () => {
  const existing = stamp({ value: 100, at: now() }); await db.glucose.add(existing)
  const backup = await exportBackup(); backup.data.glucose[0] = { ...existing, value: 200 }
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.conflicts.glucose).toBe(1)
  await restoreBackup(preview, 'keep')
  expect((await db.glucose.get(existing.id))?.value).toBe(100)
})

it('bloqueia restauração com relacionamento inválido', async () => {
  const backup = await exportBackup(); backup.data.glucose.push(stamp({ value: 100, at: now(), mealId: 'ausente' }))
  const preview = await previewBackup(JSON.stringify(backup))
  expect(preview.relationshipErrors).toHaveLength(1)
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow(/referências inválidas/)
})

it('faz rollback da transação se uma tabela falhar', async () => {
  const source = stamp({ value: 100, at: now() }); await db.glucose.add(source); const backup = await exportBackup(); await db.glucose.clear()
  const preview = await previewBackup(JSON.stringify(backup)); vi.spyOn(db.glucose, 'bulkAdd').mockRejectedValueOnce(new Error('falha simulada'))
  await expect(restoreBackup(preview, 'keep')).rejects.toThrow('falha simulada')
  expect(await db.glucose.count()).toBe(0)
})
