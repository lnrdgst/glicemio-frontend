import { useEffect, useState } from 'react'
import type { Appointment } from './database/db'
import { AppointmentError, setAttendance } from './database/appointments'
import { attendanceCandidate, attendanceDismissalKey, attendanceLabel, attendanceSnooze, attendanceStatus } from './shared/appointments'
import { dateTime } from './shared/format'
import { useLocalClock } from './shared/useLocalClock'
import { Button, usePersistence, ValidationError } from './shared/ui'
import { ConfirmDialog } from './shared/ConfirmDialog'

async function persist(appointment: Appointment, confirmed: boolean) {
  try { await setAttendance(appointment, confirmed) }
  catch (error) { if (error instanceof AppointmentError) throw new ValidationError(error.message); throw error }
}

export function HomeAppointmentAttendance({ appointments, now }: { appointments: Appointment[]; now: Date }) {
  const { run, saving, error } = usePersistence('Não foi possível confirmar o comparecimento. Tente novamente.')
  const [handled, setHandled] = useState({ through: -Infinity, until: 0 })
  const [snoozed, setSnoozed] = useState<Map<string, number>>(() => new Map())
  const [storageError, setStorageError] = useState(false)
  const [, refresh] = useState(0)
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === null || event.key.startsWith('glicemio-appointment-later:')) refresh(value => value + 1) }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  const candidate = attendanceCandidate(appointments, now.getTime())
  let until = candidate ? snoozed.get(attendanceDismissalKey(candidate)) ?? 0 : 0
  if (candidate) {
    try { const saved = Number(localStorage.getItem(attendanceDismissalKey(candidate))); if (Number.isFinite(saved)) until = Math.max(until, saved) } catch { /* A dispensa em memória continua válida nesta abertura. */ }
  }
  if (!candidate || (Date.parse(candidate.at) <= handled.through && now.getTime() < handled.until) || until > now.getTime()) return storageError ? <p className="muted" role="status">Pergunta adiada nesta abertura. Não foi possível salvar o adiamento no dispositivo.</p> : null
  const confirm = () => void run(async () => { await persist(candidate, true); setHandled({ through: Date.parse(candidate.at), until: Infinity }) })
  const later = () => {
    const key = attendanceDismissalKey(candidate), next = now.getTime() + attendanceSnooze
    setSnoozed(values => new Map(values).set(key, next)); setHandled({ through: Date.parse(candidate.at), until: next })
    try { localStorage.setItem(key, String(next)) } catch { setStorageError(true) }
  }
  return <aside className="appointment-attendance" aria-label="Confirmação de comparecimento à consulta" aria-live="polite">
    <b>Você compareceu à consulta?</b>
    <p>{attendanceLabel(candidate)}</p><p>Agendada para {dateTime(candidate.at)}</p>
    <div className="actions"><Button type="button" disabled={saving} onClick={confirm}>{saving ? 'Salvando…' : 'Compareci'}</Button><button className="secondary" type="button" disabled={saving} onClick={later}>Agora não</button></div>
    {error && <p role="alert">{error}</p>}
  </aside>
}

export function AppointmentAttendanceDetails({ appointment }: { appointment: Appointment }) {
  const clock = useLocalClock(Date.parse(appointment.at))
  const { run, saving, error } = usePersistence('Não foi possível atualizar o comparecimento. Tente novamente.')
  const [undo, setUndo] = useState(false)
  const canConfirm = Number.isFinite(Date.parse(appointment.at)) && Date.parse(appointment.at) <= clock.getTime()
  return <div className="appointment-attendance-details">
    <p>{attendanceStatus(appointment, clock.getTime())}</p>
    {appointment.attendanceConfirmed === true ? <button className="secondary" type="button" onClick={() => setUndo(true)}>Desfazer confirmação</button> : canConfirm && <Button type="button" disabled={saving} onClick={() => void run(() => persist(appointment, true))}>{saving ? 'Salvando…' : 'Compareci'}</Button>}
    {!undo && error && <p role="alert">{error}</p>}
    {undo && <ConfirmDialog title="Desfazer confirmação de comparecimento?" confirmLabel="Desfazer confirmação" busyLabel="Salvando…" irreversible={false} saving={saving} error={error} onCancel={() => setUndo(false)} onConfirm={() => void run(async () => { await persist(appointment, false); setUndo(false) })}><p>A consulta continuará cadastrada, com o horário original e o comparecimento não confirmado.</p></ConfirmDialog>}
  </div>
}
