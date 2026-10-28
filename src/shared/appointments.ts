import type { Appointment } from '../database/db'

export const attendanceLabel = (record: Pick<Appointment, 'attendanceType' | 'attendanceTypeOther'>) =>
  (record.attendanceType === 'other' ? record.attendanceTypeOther || 'Outro' : ({ general: 'Clínico geral', endocrinologist: 'Endocrinologista', nutritionist: 'Nutricionista', ophthalmologist: 'Oftalmologista' } as Record<string, string>)[record.attendanceType ?? ''] || 'Especialidade não informada')

export function attendanceStatus(appointment: Appointment, now = Date.now()) {
  if (appointment.attendanceConfirmed === true) return 'Comparecimento confirmado'
  return Date.parse(appointment.at) > now ? 'Agendada' : 'Comparecimento não confirmado'
}

const newestFirst = (a: Appointment, b: Appointment) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id)
export function endocrinologyReferences(appointments: Appointment[], now = Date.now()) {
  return appointments.filter(item => item.attendanceType === 'endocrinologist' && item.attendanceConfirmed === true && Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) <= now).sort(newestFirst)
}

export const attendanceWindow = 48 * 60 * 60 * 1000
export const attendanceSnooze = 24 * 60 * 60 * 1000
export const attendanceDismissalKey = (appointment: Pick<Appointment, 'id' | 'at'>) => `glicemio-appointment-later:${appointment.id}:${Date.parse(appointment.at)}`

// Escolha antes de aplicar adiamentos: dispensar a mais recente não deve revelar uma fila antiga.
export function attendanceCandidate(appointments: Appointment[], now: number) {
  return appointments.filter(item => item.attendanceConfirmed !== true && Number.isFinite(Date.parse(item.at)) && Date.parse(item.at) <= now && now - Date.parse(item.at) < attendanceWindow).sort(newestFirst)[0]
}

export function consultationInterval(at: string, until: number) {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(until) || date.getTime() > until) throw new Error('A consulta de referência não possui um horário passado válido.')
  return { from: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(), to: until }
}
