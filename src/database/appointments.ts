import { db, now, type Appointment } from './db'
import { sameRecord } from './structuredMeals'

export class AppointmentError extends Error {}
const stale = () => new AppointmentError('A consulta mudou desde a abertura. Reabra o registro antes de continuar.')

export async function setAttendance(expected: Appointment, confirmed: boolean) {
  expected = structuredClone(expected)
  return db.transaction('rw', db.appointments, async () => {
    const current = await db.appointments.get(expected.id)
    if (!current) throw new AppointmentError('Esta consulta não está mais disponível.')
    if ((current.attendanceConfirmed === true) === confirmed) return
    if (!sameRecord(current, expected)) throw stale()
    if (confirmed && (!Number.isFinite(Date.parse(current.at)) || Date.parse(current.at) > Date.now())) throw new AppointmentError('O comparecimento só pode ser confirmado a partir do horário agendado.')
    const next = { ...current, updatedAt: now() }
    if (confirmed) next.attendanceConfirmed = true
    else delete next.attendanceConfirmed
    await db.appointments.put(next)
  })
}

export async function editAppointment(expected: Appointment, changes: Partial<Appointment>) {
  expected = structuredClone(expected); changes = structuredClone(changes)
  return db.transaction('rw', db.appointments, async () => {
    const current = await db.appointments.get(expected.id)
    if (!current || !sameRecord(current, expected)) throw stale()
    if (current.attendanceConfirmed === true && changes.at !== undefined && changes.at !== current.at) throw new AppointmentError('Desfaça a confirmação de comparecimento nos detalhes antes de alterar o horário.')
    await db.appointments.put({ ...current, ...changes, id: current.id, createdAt: current.createdAt, attendanceConfirmed: current.attendanceConfirmed, updatedAt: now() })
  })
}
