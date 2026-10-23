import { db, type Meal } from './db'
import { backupIntegrityErrors, backupTables, exportBackup, parseBackup, type BackupData, type BackupFile } from './backup'

export type MealReferencePreview = { backup: BackupFile; meals: Meal[] }
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const signature = (data: BackupData) => canonical(Object.fromEntries(backupTables.map(table => [table, [...data[table]].sort((a, b) => a.id.localeCompare(b.id))])))
const unconfirmed = (meal: Meal) => meal.timeReference === undefined || meal.timeReference === 'unconfirmed'
function assertIntegrity(data: BackupData) {
  parseBackup(JSON.stringify(data))
  if (backupIntegrityErrors(data).length) throw new Error('Há referências ausentes nos dados. A classificação foi bloqueada; nenhum registro foi alterado.')
}

export async function prepareMealReferencePreview(): Promise<MealReferencePreview> {
  const backup = await exportBackup()
  assertIntegrity(backup.data)
  return { backup, meals: backup.data.meals.filter(unconfirmed) }
}

export function verifyMealReferenceBackup(preview: MealReferencePreview, text: string) {
  const { data } = parseBackup(text)
  assertIntegrity(data)
  if (signature(data) !== signature(preview.backup.data)) throw new Error('O arquivo não corresponde ao backup completo desta prévia. Prepare uma nova prévia e confira o arquivo salvo.')
}

export async function classifyMealReferences(preview: MealReferencePreview, selectedIds: string[], savedBackup: string, confirmed: boolean) {
  if (!confirmed) throw new Error('Confirme a propriedade das refeições e o uso do horário de fim.')
  verifyMealReferenceBackup(preview, savedBackup)
  const ids = new Set(selectedIds)
  if (!ids.size || ids.size !== selectedIds.length || selectedIds.some(id => !preview.meals.some(meal => meal.id === id && unconfirmed(meal)))) throw new Error('Selecione somente refeições sem referência confirmada nesta prévia.')
  return db.transaction('rw', db.tables, async () => {
    const before = (await exportBackup()).data
    assertIntegrity(before)
    if (signature(before) !== signature(preview.backup.data)) throw new Error('Os dados mudaram desde a prévia. Prepare uma nova prévia e um novo backup antes de continuar.')
    for (const id of ids) {
      const meal = await db.meals.get(id)
      if (!meal || !unconfirmed(meal)) throw new Error('A refeição mudou desde a prévia. Nenhum registro foi alterado.')
      // Altere somente o significado declarado; preserve inclusive updatedAt.
      await db.meals.update(id, { timeReference: 'meal_end' })
    }
    const after = (await exportBackup()).data
    const expected = { ...before, meals: before.meals.map(meal => ids.has(meal.id) ? { ...meal, timeReference: 'meal_end' as const } : meal) }
    if (signature(after) !== signature(expected)) throw new Error('A verificação de integridade falhou. A classificação foi cancelada.')
    return ids.size
  })
}
