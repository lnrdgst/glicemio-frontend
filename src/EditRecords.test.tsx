import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'
import { iso } from './shared/format'

const open = (route: string) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const edit = async () => {
  await userEvent.click(await screen.findByRole('link', { name: 'Editar' }))
  await screen.findByRole('button', { name: 'Salvar alterações' })
}
const save = () => userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('edita glicemia pelo Histórico preservando UUID, criação e vínculo selecionado', async () => {
  const meal = stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }); await db.meals.add(meal)
  const record = stamp({ value: 110, at: iso('2026-10-14T13:00'), context: 'Após refeição', mealId: meal.id }); await db.glucose.add(record)
  open('/detalhes/glucose/' + record.id); await edit(); change('Valor (mg/dL)', '135'); await save()
  const updated = await db.glucose.get(record.id)
  expect(updated).toMatchObject({ id: record.id, createdAt: record.createdAt, value: 135, mealId: meal.id })
  expect(updated?.updatedAt).not.toBe(record.updatedAt)
})

it('edita refeição, treino e consulta sem criar duplicatas', async () => {
  const meal = stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }); const workout = stamp({ activity: 'Caminhada', startedAt: iso('2026-10-14T08:00') }); const appointment = stamp({ at: iso('2026-10-20T09:00'), professional: 'Ana' })
  await db.meals.add(meal); await db.workouts.add(workout); await db.appointments.add(appointment)
  const view = open('/detalhes/meals/' + meal.id); await edit(); change('Tipo de refeição', 'Jantar'); await save(); expect((await db.meals.toArray())).toHaveLength(1); expect((await db.meals.get(meal.id))?.kind).toBe('Jantar')
  view.unmount(); open('/detalhes/workouts/' + workout.id); await edit(); change('Atividade', 'Corrida'); await save(); expect((await db.workouts.toArray())).toHaveLength(1); expect((await db.workouts.get(workout.id))?.activity).toBe('Corrida')
  cleanup(); open('/detalhes/appointments/' + appointment.id); await edit(); change('Tipo de atendimento', 'endocrinologist'); change('Nome do profissional (opcional)', 'Bia'); await save(); expect((await db.appointments.toArray())).toHaveLength(1); expect(await db.appointments.get(appointment.id)).toMatchObject({ professional: 'Bia', attendanceType: 'endocrinologist' })
})

it('corrige somente o horário de uma insulina preservando dose, medicamento e identificador', async () => {
  const record = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: iso('2026-10-14T09:00'), medicationId: 'glargine-u100', medicationName: 'Glargina U100', medicationKey: 'glargine-u100', note: 'Noite' })
  await db.insulin.add(record); open('/detalhes/insulin/' + record.id); await edit()
  change('Hora', '21:00'); await save()
  expect(await db.insulin.get(record.id)).toEqual(expect.objectContaining({ id: record.id, createdAt: record.createdAt, dose: 18, medicationId: 'glargine-u100', medicationName: 'Glargina U100', medicationKey: 'glargine-u100', note: 'Noite', at: iso('2026-10-14T21:00') }))
  expect(await db.insulin.count()).toBe(1)
})

it('edita episódio e permite abrir registros da Home e Histórico em detalhes', async () => {
  const episode = stamp({ startedAt: iso('2026-10-14T08:00'), symptoms: ['Tremor'] }); const glucose = stamp({ value: 100, at: iso('2026-10-14T09:00') })
  await db.episodes.add(episode); await db.glucose.add(glucose)
  open('/detalhes/episodes/' + episode.id); await edit(); await userEvent.click(screen.getByLabelText('Suor')); await save()
  expect((await db.episodes.get(episode.id))?.symptoms).toEqual(['Tremor', 'Suor'])
  cleanup(); open('/'); await userEvent.click(await screen.findByText('100')); expect(await screen.findByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/glicemia/' + glucose.id + '/editar')
})

it('reposiciona Histórico e atualiza relatório após editar horário e glicemia', async () => {
  const first = stamp({ value: 100, at: iso('2026-10-14T08:00') }); const second = stamp({ value: 200, at: iso('2026-10-14T09:00') })
  await db.glucose.bulkAdd([first, second]); open('/detalhes/glucose/' + first.id); await edit(); change('Hora', '10:00'); await save()
  cleanup(); open('/historico'); await screen.findByText(/100 mg\/dL/); expect(document.querySelectorAll('.item')[0]).toHaveTextContent('100 mg/dL')
  cleanup(); open('/relatorio'); await waitFor(() => expect(screen.getByText('Média aritmética simples').closest('section')?.textContent).toContain('150 mg/dL'))
})

it('mostra somente a categoria existente na Home e preserva a outra ao editar', async () => {
  const basal = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: iso('2026-10-14T21:00') }); await db.insulin.add(basal)
  open('/'); expect(await screen.findByText('18 UI')).toBeInTheDocument(); expect(screen.queryByText('Rápida')).toBeNull()
  cleanup(); open('/detalhes/insulin/' + basal.id); await edit(); change('Hora', '22:00'); await save(); expect((await db.insulin.get(basal.id))?.dose).toBe(18)
})

it('mantém dados preenchidos quando a atualização falha', async () => {
  const record = stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }); await db.meals.add(record)
  vi.spyOn(db.meals, 'put').mockRejectedValueOnce(new Error('IndexedDB indisponível'))
  open('/detalhes/meals/' + record.id); await edit(); change('Tipo de refeição', 'Jantar'); await save()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar')
  expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Jantar')
  expect(await db.meals.get(record.id)).toEqual(record)
})

it('retorna dos detalhes diretamente para a Home', async () => {
  const record = stamp({ value: 120, at: iso('2026-10-14T12:00') }); await db.glucose.add(record)
  open('/detalhes/glucose/' + record.id)
  await userEvent.click(await screen.findByRole('link', { name: /Início/ }))
  expect(await screen.findByRole('heading', { name: 'Olá, Teste' })).toBeInTheDocument()
})

it('volta da edição para os detalhes sem descartar alterações silenciosamente', async () => {
  const record = stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }); await db.meals.add(record)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  open('/detalhes/meals/' + record.id); await edit(); change('Tipo de refeição', 'Jantar')
  await userEvent.click(screen.getByRole('link', { name: /Voltar/ }))
  expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Jantar')
  await userEvent.click(screen.getByRole('link', { name: /Voltar/ }))
  expect(await screen.findByRole('link', { name: 'Editar' })).toBeInTheDocument()
  expect(await db.meals.get(record.id)).toEqual(record)
  expect(confirm).toHaveBeenCalledTimes(2)
})

it('protege alterações não salvas ao usar a navegação inferior', async () => {
  const record = stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }); await db.meals.add(record)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  open('/detalhes/meals/' + record.id); await edit(); change('Tipo de refeição', 'Jantar')
  await userEvent.click(screen.getByRole('link', { name: 'Histórico' }))
  expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Jantar')
  expect(await db.meals.get(record.id)).toEqual(record)
})
