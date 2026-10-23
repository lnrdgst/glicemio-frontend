import { db, type Appointment, type Episode, type Glucose, type Insulin, type Meal, type Profile, type Workout } from './db'

export const backupTables = ['profiles', 'glucose', 'meals', 'insulin', 'workouts', 'episodes', 'appointments'] as const
type BackupTable = typeof backupTables[number]
export type BackupData = { profiles: Profile[]; glucose: Glucose[]; meals: Meal[]; insulin: Insulin[]; workouts: Workout[]; episodes: Episode[]; appointments: Appointment[] }
export type BackupFile = { format: 'glicoponto-backup'; version: 1; exportedAt: string; data: BackupData }
export type ProfileStrategy = 'keep' | 'restore'
export type ImportPreview = { sourceVersion: 'legacy' | 1; data: BackupData; additions: Record<BackupTable, number>; duplicates: Record<BackupTable, number>; conflicts: Record<BackupTable, number>; relationshipErrors: string[]; profileConflict: boolean }

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const date = (value: unknown) => typeof value === 'string' && text(value) && Number.isFinite(Date.parse(value))
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const list = (value: unknown) => Array.isArray(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function base(record: Record<string, unknown>) { return text(record.id) && date(record.createdAt) && date(record.updatedAt) }
function validate(table: BackupTable, record: unknown) {
  if (!object(record) || !base(record)) return false
  if (table === 'profiles') return record.id === 'local' && text(record.name) && (record.diagnosis === undefined || typeof record.diagnosis === 'string') && (record.workoutActivities === undefined || (list(record.workoutActivities) && record.workoutActivities.every(value => typeof value === 'string')))
  if (table === 'meals') return text(record.kind) && date(record.at) && (record.description === undefined || typeof record.description === 'string') && (record.timeReference === undefined || record.timeReference === 'meal_start' || record.timeReference === 'meal_end' || record.timeReference === 'unconfirmed')
  if (table === 'glucose') { const value = record.value; return typeof value === 'number' && number(value) && value > 0 && date(record.at) && (record.mealId === undefined || text(record.mealId)) && (record.episodeId === undefined || text(record.episodeId)) }
  if (table === 'insulin') { const dose = record.dose; return (record.kind === 'Rápida' || record.kind === 'Basal/lenta') && typeof dose === 'number' && number(dose) && dose > 0 && date(record.at) && (record.mealId === undefined || text(record.mealId)) }
  if (table === 'workouts') return text(record.activity) && date(record.startedAt) && (record.endedAt === undefined || date(record.endedAt))
  if (table === 'episodes') return date(record.startedAt) && (record.endedAt === undefined || date(record.endedAt)) && list(record.symptoms) && record.symptoms.every(value => typeof value === 'string')
  return date(record.at)
}

function dataFrom(value: unknown): { data: BackupData; sourceVersion: 'legacy' | 1 } {
  if (!object(value)) throw new Error('O arquivo não contém um objeto de backup válido.')
  const wrapped = value.format === 'glicoponto-backup' || value.version !== undefined
  if (wrapped && (value.format !== 'glicoponto-backup' || value.version !== 1 || !date(value.exportedAt) || !object(value.data))) throw new Error('A versão do backup não é suportada.')
  const source = wrapped ? value.data : value
  if (!object(source)) throw new Error('A estrutura de dados do backup é inválida.')
  const result = {} as BackupData
  for (const table of backupTables) {
    const records = source[table]
    if (!list(records)) throw new Error(`A coleção “${table}” está ausente ou inválida.`)
    if (!records.every(record => validate(table, record))) throw new Error(`A coleção “${table}” contém registros inválidos.`)
    const ids = records.map(record => (record as { id: string }).id)
    if (new Set(ids).size !== ids.length) throw new Error(`A coleção “${table}” contém IDs duplicados.`)
    ;(result as Record<BackupTable, unknown[]>)[table] = records
  }
  return { data: result, sourceVersion: wrapped ? 1 : 'legacy' }
}

async function currentData(): Promise<BackupData> {
  const [profiles, glucose, meals, insulin, workouts, episodes, appointments] = await Promise.all([db.profiles.toArray(), db.glucose.toArray(), db.meals.toArray(), db.insulin.toArray(), db.workouts.toArray(), db.episodes.toArray(), db.appointments.toArray()])
  return { profiles, glucose, meals, insulin, workouts, episodes, appointments }
}

function relationshipErrors(data: BackupData, existing: BackupData) {
  const mealIds = new Set([...data.meals, ...existing.meals].map(record => record.id))
  const episodeIds = new Set([...data.episodes, ...existing.episodes].map(record => record.id))
  const errors: string[] = []
  for (const record of data.glucose) { if (record.mealId && !mealIds.has(record.mealId)) errors.push(`Glicemia ${record.id} referencia uma refeição inexistente.`); if (record.episodeId && !episodeIds.has(record.episodeId)) errors.push(`Glicemia ${record.id} referencia um episódio inexistente.`) }
  for (const record of data.insulin) if (record.mealId && !mealIds.has(record.mealId)) errors.push(`Insulina ${record.id} referencia uma refeição inexistente.`)
  return errors
}

export async function exportBackup(): Promise<BackupFile> { return db.transaction('r', db.tables, async () => ({ format: 'glicoponto-backup' as const, version: 1 as const, exportedAt: new Date().toISOString(), data: await currentData() })) }

export function parseBackup(textContent: string) {
  let parsed: unknown
  try { parsed = JSON.parse(textContent) } catch { throw new Error('Não foi possível ler o JSON selecionado.') }
  return dataFrom(parsed)
}

export function backupIntegrityErrors(data: BackupData) { return relationshipErrors(data, data) }

export async function previewBackup(textContent: string): Promise<ImportPreview> {
  const { data, sourceVersion } = parseBackup(textContent); const existing = await currentData()
  const additions = {} as Record<BackupTable, number>; const duplicates = {} as Record<BackupTable, number>; const conflicts = {} as Record<BackupTable, number>
  for (const table of backupTables) {
    const current = new Map(existing[table].map(record => [record.id, record]))
    additions[table] = data[table].filter(record => !current.has(record.id)).length
    duplicates[table] = data[table].filter(record => current.has(record.id) && same(current.get(record.id), record)).length
    conflicts[table] = data[table].filter(record => current.has(record.id) && !same(current.get(record.id), record)).length
  }
  return { sourceVersion, data, additions, duplicates, conflicts, relationshipErrors: relationshipErrors(data, existing), profileConflict: Boolean(existing.profiles.find(record => record.id === 'local') && data.profiles.find(record => record.id === 'local')) }
}

export async function restoreBackup(preview: ImportPreview, profileStrategy: ProfileStrategy): Promise<Record<BackupTable, number>> {
  if (preview.relationshipErrors.length) throw new Error('O backup possui referências inválidas e não pode ser restaurado.')
  const imported = Object.fromEntries(backupTables.map(table => [table, 0])) as Record<BackupTable, number>
  const tables = { profiles: db.profiles, glucose: db.glucose, meals: db.meals, insulin: db.insulin, workouts: db.workouts, episodes: db.episodes, appointments: db.appointments }
  await db.transaction('rw', [db.profiles, db.glucose, db.meals, db.insulin, db.workouts, db.episodes, db.appointments], async () => {
    for (const table of backupTables) {
      const target = tables[table] as any
      const current = new Map((await target.toArray()).map((record: { id: string }) => [record.id, record]))
      const candidates = preview.data[table].filter(record => !current.has(record.id))
      if (table === 'profiles' && profileStrategy === 'restore') {
        const profile = preview.data.profiles.find(record => record.id === 'local')
        if (profile) { await db.profiles.put(profile); imported.profiles = 1 }
      } else if (candidates.length) { await target.bulkAdd(candidates); imported[table] = candidates.length }
    }
  })
  return imported
}
