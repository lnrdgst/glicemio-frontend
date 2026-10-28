import type { Appointment } from './db'
import { backupIntegrityErrors, exportBackup, parseBackup, type BackupData, type BackupFile } from './backup'
import { consultationInterval, endocrinologyReferences } from '../shared/appointments'

export type AppointmentExport = { backup: BackupFile; reference: Appointment; from: number; to: number; clinicalCount: number }
export const noEndocrinologyReference = 'Nenhuma consulta com o endocrinologista tem comparecimento confirmado e horário não futuro. Confirme uma consulta pelos detalhes no Histórico ou exporte todos os dados.'

export function sliceAppointmentExport(snapshot: BackupFile, selected?: Pick<Appointment, 'id' | 'at'>): AppointmentExport {
  const to = Date.parse(snapshot.exportedAt), candidates = endocrinologyReferences(snapshot.data.appointments, to)
  const reference = selected ? candidates.find(item => item.id === selected.id && item.at === selected.at) : candidates[0]
  if (!reference) throw new Error(selected ? 'A consulta de referência mudou ou não está mais elegível. Revise a seleção antes de exportar.' : noEndocrinologyReference)
  const interval = consultationInterval(reference.at, to)
  const within = (at: string) => { const instant = Date.parse(at); return Number.isFinite(instant) && instant >= interval.from && instant <= to }
  const overlaps = (item: { startedAt: string; endedAt?: string }) => {
    const start = Date.parse(item.startedAt), end = item.endedAt === undefined ? Infinity : Date.parse(item.endedAt)
    if (!Number.isFinite(start) || (item.endedAt !== undefined && (!Number.isFinite(end) || end < start))) throw new Error('Há um treino ou episódio com intervalo inválido. A exportação não alterou os dados locais.')
    return start <= to && end >= interval.from
  }
  const source = snapshot.data
  const glucose = source.glucose.filter(item => within(item.at)), insulin = source.insulin.filter(item => within(item.at))
  const temporalMeals = source.meals.filter(item => within(item.at)), temporalEpisodes = source.episodes.filter(overlaps)
  const mealIds = new Set(temporalMeals.map(item => item.id)), episodeIds = new Set(temporalEpisodes.map(item => item.id))
  for (const item of [...glucose, ...insulin]) if (item.mealId) mealIds.add(item.mealId)
  for (const item of glucose) if (item.episodeId) episodeIds.add(item.episodeId)
  const meals = source.meals.filter(item => mealIds.has(item.id)), episodes = source.episodes.filter(item => episodeIds.has(item.id))
  const mealItems = source.mealItems.filter(item => mealIds.has(item.mealId)), foodIds = new Set(mealItems.flatMap(item => item.foodId ? [item.foodId] : []))
  const workouts = source.workouts.filter(overlaps)
  const data: BackupData = { profiles: source.profiles, glucose, meals, insulin, workouts, episodes, appointments: source.appointments.filter(item => within(item.at)), mealItems, foods: source.foods.filter(item => foodIds.has(item.id)) }
  const backup: BackupFile = { ...snapshot, data }
  // Valide o próprio arquivo, sem aproveitar pais presentes no dispositivo de destino.
  parseBackup(JSON.stringify(backup))
  const errors = backupIntegrityErrors(data)
  if (errors.length) throw new Error(`Não foi possível exportar: ${errors.join(' ')} Nenhum dado local foi alterado.`)
  // Perfil, consultas e dependências anteriores não representam novas medições.
  const clinicalCount = glucose.length + insulin.length + temporalMeals.filter(item => !item.deletedAt).length + workouts.length + temporalEpisodes.length
  return { backup, reference, ...interval, clinicalCount }
}

export async function exportSinceEndocrinology(selected?: Pick<Appointment, 'id' | 'at'>) {
  return sliceAppointmentExport(await exportBackup(), selected)
}
