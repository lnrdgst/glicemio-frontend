import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'

const open = (route: string) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Perfil de teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('edita perfil, diagnóstico e modalidades opcionais preservando a criação', async () => {
  const previous = await db.profiles.get('local')
  open('/mais'); const name = await screen.findByLabelText('Nome')
  fireEvent.change(name, { target: { value: 'Novo nome' } })
  fireEvent.change(screen.getByLabelText(/Diagnóstico informado/), { target: { value: 'Diabetes tipo 2' } })
  fireEvent.change(screen.getByLabelText(/Modalidades de treino/), { target: { value: 'Musculação, musculacao; Natação' } })
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo')
  expect(await db.profiles.get('local')).toMatchObject({ name: 'Novo nome', diagnosis: 'Diabetes tipo 2', workoutActivities: ['Musculação', 'Natação'], createdAt: previous?.createdAt })
})

it('registra, edita e encerra um episódio sem perder vínculos de glicemia', async () => {
  open('/episodio'); await userEvent.click(screen.getByLabelText('Tremor')); await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await screen.findByRole('heading', { name: 'Acompanhando sintomas' })
  const episode = (await db.episodes.toArray())[0]
  await userEvent.click(screen.getByLabelText('Tremor')); await userEvent.click(screen.getByLabelText('Suor')); await userEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(async () => expect((await db.episodes.get(episode.id))?.symptoms).toEqual(['Suor']))
  await userEvent.click(screen.getByRole('link', { name: 'Registrar glicemia' }))
  fireEvent.change(screen.getByLabelText('Valor (mg/dL)'), { target: { value: '100' } }); await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' }))
  await screen.findByRole('status'); expect((await db.glucose.toArray())[0]?.episodeId).toBe(episode.id)
  await userEvent.click(screen.getByRole('link', { name: 'Estou com sintomas' }))
  await screen.findByRole('heading', { name: 'Acompanhando sintomas' }); await userEvent.click(screen.getByRole('button', { name: 'Encerrar episódio' }))
  await screen.findByRole('heading', { name: 'Olá, Perfil de teste' })
  expect((await db.episodes.get(episode.id))?.endedAt).toBeTruthy()
})

it('salva consulta e a apresenta como próxima na Home', async () => {
  open('/consulta'); const future = new Date(); future.setDate(future.getDate() + 7); future.setMinutes(future.getMinutes() - future.getTimezoneOffset())
  const [date, time] = future.toISOString().slice(0, 16).split('T')
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: date } })
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: time } })
  fireEvent.change(screen.getByLabelText('Nome do profissional (opcional)'), { target: { value: 'Profissional de teste' } })
  await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' })); expect(await screen.findByText('Próxima consulta')).toBeInTheDocument()
  expect(await db.appointments.count()).toBe(1)
})

it('mantém estatísticas determinísticas e histórico em ordem efetiva', async () => {
  const base = Date.now()
  await db.glucose.bulkAdd([stamp({ value: 90, at: new Date(base - 3600000).toISOString() }), stamp({ value: 150, at: new Date(base - 7200000).toISOString() })])
  const view = open('/relatorio'); const average = await screen.findByText('Média aritmética simples')
  await waitFor(() => expect(within(average.closest('section')!).getByText('120 mg/dL')).toBeInTheDocument())
  view.unmount(); open('/historico'); await screen.findByText(/90 mg\/dL/)
  const lines = document.querySelectorAll('.item'); expect(lines[0]).toHaveTextContent('90 mg/dL'); expect(lines[1]).toHaveTextContent('150 mg/dL')
})

it('exporta JSON completo incluindo legados, sem modificar o armazenamento', async () => {
  const legacy = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: now() }); await db.insulin.add(legacy)
  const create = vi.fn((_blob: Blob) => 'blob:test'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke })
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  open('/mais'); await userEvent.click(screen.getByRole('button', { name: 'Exportar JSON' }))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  const blob = create.mock.calls[0][0] as unknown as Blob
  const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
  const exported = JSON.parse(text)
  expect(exported).toMatchObject({ format: 'glicoponto-backup', version: 1 }); expect(exported.data.insulin).toEqual([legacy]); expect(Object.keys(exported.data)).toHaveLength(7)
  expect(await db.insulin.get(legacy.id)).toEqual(legacy); expect(revoke).toHaveBeenCalledWith('blob:test')
})

it('exclui somente após confirmação e preserva os outros registros', async () => {
  const glucose = stamp({ value: 123, at: now() }); const meal = stamp({ kind: 'Almoço', at: now() })
  await db.glucose.add(glucose); await db.meals.add(meal)
  const confirmation = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  open('/historico'); await userEvent.click(await screen.findByRole('link', { name: /123 mg\/dL/ }))
  await userEvent.click(await screen.findByRole('button', { name: 'Excluir' })); expect(await db.glucose.count()).toBe(1)
  await userEvent.click(screen.getByRole('button', { name: 'Excluir' })); await waitFor(async () => expect(await db.glucose.count()).toBe(0))
  expect(confirmation).toHaveBeenCalledTimes(2); expect(await db.meals.get(meal.id)).toEqual(meal)
})

it('informa falha de leitura sem redirecionar para cadastro ou sobrescrever perfil', async () => {
  vi.spyOn(db.profiles, 'get').mockRejectedValueOnce(new Error('IndexedDB indisponível'))
  open('/'); expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento local está indisponível')
  expect(screen.queryByText('Vamos começar pelo essencial.')).toBeNull()
  expect((await db.profiles.get('local'))?.name).toBe('Perfil de teste')
})
