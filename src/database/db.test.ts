import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, GlicopontoDB, stamp } from './db'

describe('persistência local Glicemio', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })

  it('migra v1 para v2 preservando integralmente todas as tabelas e campos legados', async () => {
    const name = `glicoponto-migration-test-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({ profiles: 'id', meals: 'id,at', glucose: 'id,at,mealId,episodeId', insulin: 'id,at,mealId', workouts: 'id,startedAt', episodes: 'id,startedAt', appointments: 'id,at' })
    const at = '2026-10-12T21:15:00.000Z'
    const fixtures = {
      profiles: [{ id: 'local', name: 'Legado', createdAt: at, updatedAt: at }],
      meals: [stamp({ kind: 'Jantar', at })], glucose: [stamp({ value: 120, at, context: 'Jejum' })],
      insulin: [stamp({ kind: 'Basal/lenta', dose: 18, at, mealId: 'vínculo-legado', note: 'Sem nome' })],
      workouts: [stamp({ activity: 'MUSCULAÇÃO', startedAt: at, source: 'local', externalReference: 'preservar' })],
      episodes: [stamp({ startedAt: at, symptoms: ['Tremor'] })], appointments: [stamp({ at, professional: 'Profissional' })],
    }
    for (const [table, rows] of Object.entries(fixtures)) await legacy.table(table).bulkAdd(rows)
    legacy.close()
    const upgraded = new GlicopontoDB(name)
    try {
      await upgraded.open(); expect(upgraded.verno).toBe(2)
      for (const [table, rows] of Object.entries(fixtures)) expect(await upgraded.table(table).toArray()).toEqual(rows)
      expect(upgraded.insulin.schema.indexes.map(index => index.name)).toContain('medicationKey')
    } finally { upgraded.close(); await Dexie.delete(name) }
  })

  it('persiste perfil e vínculo contextual entre refeição e glicemia', async () => {
    await db.profiles.put({ id: 'local', name: 'Pessoa', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
    const meal = stamp({ kind: 'Almoço', at: '2026-01-01T12:00:00.000Z' })
    await db.meals.add(meal)
    await db.glucose.add(stamp({ value: 120, at: '2026-01-01T13:00:00.000Z', mealId: meal.id }))

    expect((await db.profiles.get('local'))?.name).toBe('Pessoa')
    expect((await db.glucose.toArray())[0]).toMatchObject({ value: 120, mealId: meal.id })
  })

  it('permite exclusão sem duplicar dados derivados', async () => {
    const record = stamp({ value: 101, at: '2026-01-01T12:00:00.000Z' })
    await db.glucose.add(record)
    await db.glucose.delete(record.id)
    expect(await db.glucose.count()).toBe(0)
  })

  it('recupera os quatro tipos e preserva valores legados ao reabrir a conexão', async () => {
    const glucose = stamp({ value: 110, at: '2026-01-01T12:00:00.000Z' })
    const meal = stamp({ kind: 'Almoço', at: glucose.at })
    const insulin = stamp({ kind: 'Basal/lenta' as const, dose: 20, at: glucose.at })
    const workout = stamp({ activity: 'Musculação', startedAt: glucose.at })
    await db.glucose.add(glucose); await db.meals.add(meal)
    await db.insulin.add(insulin); await db.workouts.add(workout)
    const reopened = new GlicopontoDB(db.name)
    try {
      expect(await reopened.glucose.get(glucose.id)).toEqual(glucose)
      expect(await reopened.meals.get(meal.id)).toEqual(meal)
      expect(await reopened.insulin.get(insulin.id)).toEqual(insulin)
      expect(await reopened.workouts.get(workout.id)).toEqual(workout)
    } finally { reopened.close() }
  })
})
