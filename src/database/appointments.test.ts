import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, stamp } from './db'
import { editAppointment, setAttendance } from './appointments'
import { attendanceCandidate, attendanceDismissalKey, attendanceSnooze, attendanceStatus, attendanceWindow, endocrinologyReferences } from '../shared/appointments'
import { exportBackup, parseBackup, previewBackup, restoreBackup } from './backup'

const at = '2026-10-27T14:00:59.123456-03:00'
beforeEach(async () => { expect(db.name).toBe('glicoponto-tests'); await Promise.all(db.tables.map(table => table.clear())); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-28T18:00:00Z') })
afterEach(() => vi.useRealTimers())

it('confirma retroativamente sem alterar nenhum campo original, inclusive timestamp com microssegundos e offset', async () => {
  const record = stamp({ at, professional: 'Teste', note: 'Preservar', extra: { legacy: true } })
  await db.appointments.add(record); await setAttendance(record, true)
  const updated = await db.appointments.get(record.id)
  expect(updated).toEqual({ ...record, attendanceConfirmed: true, updatedAt: new Date().toISOString() })
  vi.setSystemTime('2026-10-29T18:00:00Z'); await setAttendance(record, true)
  expect(await db.appointments.get(record.id)).toEqual(updated)
  await setAttendance(updated!, false)
  expect(await db.appointments.get(record.id)).toEqual({ ...record, updatedAt: new Date().toISOString() })
})

it('revalida alterações concorrentes e não ressuscita consulta excluída', async () => {
  const record = stamp({ at }); await db.appointments.add(record)
  await db.appointments.update(record.id, { note: 'Outra abertura' })
  await expect(setAttendance(record, true)).rejects.toThrow(/mudou/)
  await expect(editAppointment(record, { professional: 'Sobrescrita' })).rejects.toThrow(/mudou/)
  expect((await db.appointments.get(record.id))?.note).toBe('Outra abertura')
  await db.appointments.delete(record.id)
  await expect(setAttendance(record, true)).rejects.toThrow(/não está mais/)
  expect(await db.appointments.count()).toBe(0)
})

it('serializa toque duplo sem uma segunda alteração de updatedAt', async () => {
  const record = stamp({ at }); await db.appointments.add(record)
  const put = vi.spyOn(db.appointments, 'put')
  try { await Promise.all([setAttendance(record, true), setAttendance(record, true)]); expect(put).toHaveBeenCalledTimes(1) } finally { put.mockRestore() }
})

it('impede confirmação antes do horário, aceita o limite exato e bloqueia reagendamento confirmado', async () => {
  const record = stamp({ at: '2026-10-28T18:01:00Z' }); await db.appointments.add(record)
  await expect(setAttendance(record, true)).rejects.toThrow(/horário agendado/)
  vi.setSystemTime(record.at); await setAttendance(record, true)
  const confirmed = (await db.appointments.get(record.id))!
  await expect(editAppointment(confirmed, { at: '2026-10-29T18:00:00Z' })).rejects.toThrow(/Desfaça/)
  await editAppointment(confirmed, { professional: 'Pode editar outros campos' })
  expect((await db.appointments.get(record.id))?.at).toBe(record.at)
})

it('limita a pergunta às últimas 48h, sem presumir ausência, e vincula adiamento ao evento', () => {
  const record = stamp({ at }), time = Date.parse(at)
  expect(attendanceCandidate([record], time - 1)).toBeUndefined()
  expect(attendanceCandidate([record], time)).toEqual(record)
  expect(attendanceCandidate([record], time + attendanceWindow - 1)).toEqual(record)
  expect(attendanceCandidate([record], time + attendanceWindow)).toBeUndefined()
  expect(attendanceStatus(record, time - 1)).toBe('Agendada')
  expect(attendanceStatus(record, time)).toBe('Comparecimento não confirmado')
  expect(attendanceCandidate([{ ...record, attendanceConfirmed: true }], time)).toBeUndefined()
  expect(attendanceSnooze).toBe(24 * 60 * 60 * 1000)
  expect(attendanceDismissalKey({ ...record, at: '2026-10-27T17:00:59.123Z' })).toBe(attendanceDismissalKey(record))
  expect(attendanceDismissalKey({ ...record, at: '2026-10-27T17:01:00Z' })).not.toBe(attendanceDismissalKey(record))
})

it('seleciona somente endocrinologista estruturado, confirmado e não futuro, pela data do evento', () => {
  const base = stamp({ at: '2026-10-01T12:00:00Z', attendanceConfirmed: true, attendanceType: 'endocrinologist' as const })
  const recent = { ...base, id: 'recent', at: '2026-10-27T12:00:00Z', createdAt: '2026-01-01T00:00:00Z' }
  const all = [base, recent, { ...base, id: 'eye', at: '2026-10-28T12:00:00Z', attendanceType: 'ophthalmologist' as const }, { ...base, id: 'future', at: '2027-01-13T12:00:00Z' }, { ...base, id: 'other', attendanceType: 'other' as const, attendanceTypeOther: 'Endocrinologista' }, { ...base, id: 'unknown', attendanceType: undefined }, { ...base, id: 'unconfirmed', attendanceConfirmed: false }, { ...base, id: 'invalid', at: 'inválido' }]
  expect(endocrinologyReferences(all).map(item => item.id)).toEqual(['recent', base.id])
  vi.setSystemTime('2027-01-13T12:00:00Z')
  expect(endocrinologyReferences(all)[0].id).toBe('future')
})

it.each(['legacy', 1, 2] as const)('preserva confirmações no backup %s e não atribui estado aos antigos', async version => {
  const legacy = stamp({ at }), confirmed = stamp({ at, attendanceConfirmed: true })
  await db.appointments.bulkAdd([legacy, confirmed]); const backup = await exportBackup()
  const source = version === 'legacy' ? backup.data : { ...backup, version }
  await db.appointments.clear(); await restoreBackup(await previewBackup(JSON.stringify(source)), 'keep')
  expect(await db.appointments.get(legacy.id)).toEqual(legacy)
  expect(await db.appointments.get(confirmed.id)).toEqual(confirmed)
  const conflicting = { ...backup, data: { ...backup.data, appointments: [{ ...legacy, attendanceConfirmed: true }] } }
  const preview = await previewBackup(JSON.stringify(conflicting)); expect(preview.conflicts.appointments).toBe(1)
  await restoreBackup(preview, 'keep'); expect(await db.appointments.get(legacy.id)).toEqual(legacy)
  for (const invalid of ['true', 1, null]) expect(() => parseBackup(JSON.stringify({ ...backup, data: { ...backup.data, appointments: [{ ...legacy, attendanceConfirmed: invalid }] } }))).toThrow(/inválidos/)
})
