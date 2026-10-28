import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { HomeAppointmentAttendance } from './AppointmentAttendance'
import { db, now, stamp } from './database/db'
import { attendanceDismissalKey, attendanceSnooze } from './shared/appointments'
import { localInput } from './shared/format'
import * as appointmentStore from './database/appointments'

const present = new Date(2026, 9, 28, 15).getTime()
const open = (route = '/') => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const record = (ago = 60_000) => stamp({ at: new Date(present - ago).toISOString(), attendanceType: 'nutritionist' as const, note: 'Não remover' })
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests'); await Promise.all(db.tables.map(table => table.clear()))
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(present); localStorage.clear()
  await db.profiles.put({ id: 'local', name: 'Sintético', createdAt: now(), updatedAt: now() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear() })

it('confirma qualquer especialidade na Home, preserva o registro e não encadeia perguntas antigas', async () => {
  const older = record(120_000), latest = record(); await db.appointments.bulkAdd([older, latest])
  const create = vi.fn(); vi.stubGlobal('URL', class extends URL { static createObjectURL = create })
  open(); const prompt = await screen.findByLabelText('Confirmação de comparecimento à consulta')
  expect(prompt).toHaveTextContent('Nutricionista')
  fireEvent.click(within(prompt).getByRole('button', { name: 'Compareci' }))
  await waitFor(() => expect(screen.queryByText('Você compareceu à consulta?')).not.toBeInTheDocument())
  expect(await db.appointments.get(latest.id)).toEqual({ ...latest, attendanceConfirmed: true, updatedAt: now() })
  expect(await db.appointments.get(older.id)).toEqual(older)
  expect(create).not.toHaveBeenCalled()
})

it('persiste Agora não por 24h, não mostra fila antiga e reavalia ao retomar a PWA', async () => {
  const latest = record(), older = record(120_000); await db.appointments.bulkAdd([older, latest])
  const view = open(); fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }))
  expect(localStorage.getItem(attendanceDismissalKey(latest))).toBe(String(present + attendanceSnooze))
  expect(await db.appointments.get(latest.id)).toEqual(latest)
  view.unmount(); open(); await screen.findByRole('heading', { name: 'Olá, Sintético' })
  expect(screen.queryByText('Você compareceu à consulta?')).not.toBeInTheDocument()
  vi.setSystemTime(present + attendanceSnooze)
  await act(async () => { window.dispatchEvent(new Event('pageshow')) })
  expect(await screen.findByText('Você compareceu à consulta?')).toBeInTheDocument()
})

it('um novo horário invalida o adiamento; consultas fora das 48h continuam nos detalhes', async () => {
  const latest = record(); await db.appointments.add(latest)
  localStorage.setItem(attendanceDismissalKey(latest), String(present + attendanceSnooze))
  await db.appointments.update(latest.id, { at: new Date(present - 30_000).toISOString() })
  const view = open(); expect(await screen.findByText('Você compareceu à consulta?')).toBeInTheDocument(); view.unmount()
  const old = record(49 * 60 * 60 * 1000); await db.appointments.add(old)
  open('/detalhes/appointments/' + old.id)
  fireEvent.click(await screen.findByRole('button', { name: 'Compareci' }))
  expect(await screen.findByText('Comparecimento confirmado')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Desfazer confirmação' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).not.toHaveTextContent('não poderá ser desfeita')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Desfazer confirmação' }))
  expect(await screen.findByText('Comparecimento não confirmado')).toBeInTheDocument()
  expect(await db.appointments.get(old.id)).toEqual({ ...old, updatedAt: now() })
})

it('não confirma consultas futuras; muda na fronteira e mantém lembretes coexistentes', async () => {
  const future = record(-30_000), next = record(-60_000)
  await db.appointments.bulkAdd([future, next])
  await db.profiles.update('local', { basalReminderEnabled: true, basalReminderTime: '00:00' })
  await db.meals.add(stamp({ kind: 'Almoço', at: new Date(present - 125 * 60_000).toISOString(), timeReference: 'meal_start' }))
  await db.glucose.add(stamp({ value: 65, at: new Date(present - 130 * 60_000).toISOString() }))
  const view = open(); await screen.findByText('Consulta em breve')
  expect(screen.queryByRole('button', { name: 'Compareci' })).not.toBeInTheDocument()
  vi.setSystemTime(present + 30_000)
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  const question = await screen.findByLabelText('Confirmação de comparecimento à consulta')
  expect(question.closest('.home-notices')).toBeInTheDocument()
  expect(screen.getByText('Consulta em breve')).toBeInTheDocument()
  expect(screen.getByText('Insulina basal — lembrete')).toBeInTheDocument()
  expect(await screen.findByText('Que tal registrar sua glicemia?')).toBeInTheDocument()
  expect(screen.getByLabelText('Orientação de segurança para hipoglicemia')).toBeInTheDocument()
  expect(question.querySelectorAll('button')).toHaveLength(2)
  view.unmount(); open('/detalhes/appointments/' + next.id)
  expect(await screen.findByText('Agendada')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Compareci' })).not.toBeInTheDocument()
})

it('expira o adiamento após 24h também sem desmontar o aviso', () => {
  const latest = record()
  const view = render(<HomeAppointmentAttendance appointments={[latest]} now={new Date(present)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
  view.rerender(<HomeAppointmentAttendance appointments={[latest]} now={new Date(present + attendanceSnooze - 1)} />)
  expect(screen.queryByText('Você compareceu à consulta?')).not.toBeInTheDocument()
  view.rerender(<HomeAppointmentAttendance appointments={[latest]} now={new Date(present + attendanceSnooze)} />)
  expect(screen.getByText('Você compareceu à consulta?')).toBeInTheDocument()
})

it('protege toque duplo e mantém a pergunta se a gravação falhar', async () => {
  const latest = record(); let reject!: (error: Error) => void
  const write = vi.spyOn(appointmentStore, 'setAttendance').mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  render(<HomeAppointmentAttendance appointments={[latest]} now={new Date(present)} />)
  const button = screen.getByRole('button', { name: 'Compareci' })
  fireEvent.click(button); fireEvent.click(button); expect(write).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('falha sintética')) })
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar')
  expect(screen.getByRole('button', { name: 'Compareci' })).toBeEnabled()
})

it('preserva horário literal ao editar outros campos e exige reversão para reagendar', async () => {
  const original = { ...record(), at: '2026-10-27T14:00:59.123456-03:00', attendanceConfirmed: true }; await db.appointments.add(original)
  const view = open('/consulta/' + original.id + '/editar')
  const professional = await screen.findByLabelText('Nome do profissional (opcional)')
  fireEvent.change(professional, { target: { value: 'Teste' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações da consulta' }))
  await screen.findByRole('heading', { name: 'Olá, Sintético' })
  expect(await db.appointments.get(original.id)).toMatchObject({ at: original.at, note: original.note, professional: 'Teste', attendanceConfirmed: true })
  view.unmount(); open('/consulta/' + original.id + '/editar')
  fireEvent.change(await screen.findByLabelText('Hora'), { target: { value: '18:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações da consulta' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Desfaça a confirmação')
  expect(localInput((await db.appointments.get(original.id))!.at)).toBe(localInput(original.at))
})

it('expõe o estado de consultas no Histórico sem presumir ausência', async () => {
  await db.appointments.bulkAdd([record(), { ...record(120_000), attendanceConfirmed: true }, record(-60_000)])
  open('/historico?tipo=appointments')
  expect(await screen.findByText(/· Agendada/)).toBeInTheDocument()
  expect(screen.getByText(/· Comparecimento confirmado/)).toBeInTheDocument()
  expect(screen.getByText(/· Comparecimento não confirmado/)).toBeInTheDocument()
})
