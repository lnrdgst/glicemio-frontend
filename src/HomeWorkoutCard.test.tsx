import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'

const local = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString()
const open = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
const card = () => screen.getByRole('heading', { name: 'Últimos treinos' }).closest<HTMLElement>('.card')!
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('agrupa cada treino completo com duração abaixo dos horários e mantém os links e dados', async () => {
  const activity = 'Caminhada e mobilidade com alongamento '.repeat(4).trim()
  const latest = stamp({ activity, startedAt: local(23, 8, 0), endedAt: local(23, 9, 15) })
  const previous = stamp({ activity: 'Bicicleta', startedAt: local(22, 7, 30), endedAt: local(22, 8, 0) })
  await db.workouts.bulkAdd([latest, previous])
  const before = await db.workouts.toArray()
  open()
  await screen.findByText(activity)
  const row = within(card()).getByRole('link', { name: new RegExp(activity) })
  expect(row).toHaveAttribute('href', `/detalhes/workouts/${latest.id}`)
  const info = row.querySelector('.home-workout-info')!
  expect(info.firstElementChild).toHaveTextContent(activity)
  expect(within(row).getByText('23/10/2026')).toBeInTheDocument()
  expect(within(row).getByText('Início: 08:00')).toBeInTheDocument()
  expect(within(row).getByText('Término: 09:15')).toBeInTheDocument()
  expect(info.lastElementChild).toHaveTextContent('Duração: 75 min')
  expect(row).not.toHaveTextContent('Bicicleta')
  expect(within(card()).getByRole('link', { name: 'Últimos treinos' })).toHaveAttribute('href', '/historico?tipo=workouts')
  expect(within(card()).getByRole('link', { name: 'Registrar treino' })).toHaveAttribute('href', '/treino')
  await userEvent.click(row)
  await screen.findByRole('heading', { name: 'Treino' })
  expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', `/treino/${latest.id}/editar`)
  expect(await db.workouts.toArray()).toEqual(before)
})

it('mostra ambas as datas ao atravessar meia-noite, inclusive na virada do ano', async () => {
  const workout = stamp({ activity: 'Treino noturno', startedAt: new Date(2026, 11, 31, 23, 45).toISOString(), endedAt: new Date(2027, 0, 1, 0, 15).toISOString() })
  await db.workouts.add(workout)
  open(); await screen.findByText(workout.activity)
  expect(within(card()).getByText('31/12/2026')).toBeInTheDocument()
  expect(within(card()).getByText('Início: 23:45')).toBeInTheDocument()
  expect(within(card()).getByText('Término: 01/01/2027 às 00:15')).toBeInTheDocument()
  expect(within(card()).getByText('Duração: 30 min')).toBeInTheDocument()
  expect(await db.workouts.get(workout.id)).toEqual(workout)
})

it.each([
  { startedAt: local(22, 10, 0), endedAt: undefined, start: 'Início: 10:00', end: 'Término não registrado' },
  { startedAt: '2026-10-22', endedAt: undefined, start: 'Horário de início não registrado', end: 'Término não registrado' },
  { startedAt: local(22, 10, 0), endedAt: '2026-10-22', start: 'Início: 10:00', end: 'Término: horário não registrado' },
])('não presume horários ou duração quando faltam dados: %j', async ({ startedAt, endedAt, start, end }) => {
  const workout = stamp({ activity: 'Caminhada', startedAt, endedAt })
  await db.workouts.add(workout)
  open(); await screen.findByText(workout.activity)
  const scope = within(card())
  expect(scope.getByText('22/10/2026')).toBeInTheDocument()
  expect(scope.getByText(start)).toBeInTheDocument(); expect(scope.getByText(end)).toBeInTheDocument()
  expect(scope.queryByText(/Duração:|Em andamento|00:00/)).toBeNull()
  expect(await db.workouts.get(workout.id)).toEqual(workout)
})
