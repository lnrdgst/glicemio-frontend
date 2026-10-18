import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('edita perfil, diagnóstico e modalidades opcionais preservando a criação', async () => {
  const previous = await db.profiles.get('local')
  open('/mais'); const name = await screen.findByLabelText('Nome')
  expect(screen.getByRole('heading', { name: 'Ajustes' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Ajustes' })).toBeTruthy()
  expect(screen.getByText('Separe por vírgula ou pressione ↵ Enter para adicionar uma nova linha.')).toBeTruthy()
  expect(screen.getByLabelText('Uso habitual de insulina basal')).toBeTruthy()
  fireEvent.change(name, { target: { value: 'Novo nome' } })
  fireEvent.change(screen.getByLabelText(/Diagnóstico informado/), { target: { value: 'Diabetes tipo 2' } })
  const activities = screen.getByLabelText(/Modalidades de treino/) as HTMLTextAreaElement
  expect(activities.tagName).toBe('TEXTAREA')
  fireEvent.change(activities, { target: { value: 'Musculação, musculacao\nNatação' } }); fireEvent.keyDown(activities, { key: 'Enter' })
  expect((await db.profiles.get('local'))?.workoutActivities).toBeUndefined()
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Perfil salvo')
  expect(await db.profiles.get('local')).toMatchObject({ name: 'Novo nome', diagnosis: 'Diabetes tipo 2', workoutActivities: ['Musculação', 'Natação'], createdAt: previous?.createdAt })
})

it('mantém Ajustes restrito a Perfil e Dados e backup', async () => {
  await db.appointments.add(stamp({ at: new Date(Date.now() + 86400000).toISOString(), attendanceType: 'endocrinologist' }))
  open('/mais')
  expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Dados e backup' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Consultas' })).toBeNull()
  expect(screen.queryByRole('link', { name: /Cadastrar consulta/i })).toBeNull()
})

it.each(['yes', 'no', 'later'] as const)('persiste o uso basal opcional como %s sem ativar lembrete fora da configuração diária', async basalUsage => {
  open('/mais'); await screen.findByLabelText('Nome')
  fireEvent.change(screen.getByLabelText('Uso habitual de insulina basal'), { target: { value: basalUsage } })
  if (basalUsage === 'yes') { fireEvent.change(screen.getByLabelText('Insulina basal habitual (opcional)'), { target: { value: 'glargine-u100-basaglar' } }); await userEvent.click(screen.getByLabelText('Ativar lembrete de registro')) }
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
  expect(await db.profiles.get('local')).toMatchObject({ basalUsage, basalMedicationId: basalUsage === 'yes' ? 'glargine-u100-basaglar' : undefined, basalReminderEnabled: basalUsage === 'yes' })
})

it('mantém a preferência rápida independente e preserva aplicações históricas após alterar preferências', async () => {
  const historical = stamp({ kind: 'Rápida' as const, dose: 4, at: now(), medicationId: 'lispro', medicationName: 'Lispro', medicationKey: 'lispro' }); await db.insulin.add(historical)
  open('/mais'); await screen.findByLabelText('Nome')
  fireEvent.change(screen.getByLabelText('Uso habitual de insulina rápida/prandial'), { target: { value: 'yes' } })
  fireEvent.change(screen.getByLabelText('Insulina rápida/prandial habitual (opcional)'), { target: { value: 'lispro-humalog' } })
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' })); await screen.findByRole('status')
  expect(await db.profiles.get('local')).toMatchObject({ rapidUsage: 'yes', rapidMedicationId: 'lispro-humalog' })
  cleanup(); open('/mais'); await screen.findByLabelText('Nome')
  fireEvent.change(screen.getByLabelText('Uso habitual de insulina basal'), { target: { value: 'no' } }); fireEvent.change(screen.getByLabelText('Uso habitual de insulina rápida/prandial'), { target: { value: 'later' } })
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' })); await screen.findByRole('status')
  expect(await db.insulin.get(historical.id)).toEqual(historical)
  expect(await db.profiles.get('local')).toMatchObject({ basalUsage: 'no', rapidUsage: 'later', basalReminderEnabled: false })
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

it('salva consulta e a apresenta entre as próximas na Home', async () => {
  open('/consulta'); const future = new Date(); future.setDate(future.getDate() + 7); future.setMinutes(future.getMinutes() - future.getTimezoneOffset())
  const [date, time] = future.toISOString().slice(0, 16).split('T')
  fireEvent.change(screen.getByLabelText('Data'), { target: { value: date } })
  fireEvent.change(screen.getByLabelText('Hora'), { target: { value: time } })
  fireEvent.change(screen.getByLabelText('Nome do profissional (opcional)'), { target: { value: 'Profissional de teste' } })
  await userEvent.click(screen.getByRole('button', { name: 'Salvar registro' })); expect(await screen.findByText('Próximas consultas')).toBeInTheDocument()
  expect(await db.appointments.count()).toBe(1)
})

it('exibe somente as duas consultas futuras mais próximas, em ordem cronológica', async () => {
  const reference = Date.now()
  const first = stamp({ at: new Date(reference + 86400000).toISOString(), attendanceType: 'endocrinologist' as const, professional: 'Dra. Ana' })
  const second = stamp({ at: new Date(reference + 2 * 86400000).toISOString(), attendanceType: 'nutritionist' as const, professional: 'Profissional com nome longo para celular' })
  const third = stamp({ at: new Date(reference + 3 * 86400000).toISOString(), attendanceType: 'general' as const })
  await db.appointments.bulkAdd([third, second, first])
  open('/')
  await screen.findByText('Próximas consultas')
  await waitFor(() => expect(document.querySelectorAll('.home-appointment')).toHaveLength(2))
  const appointments = document.querySelectorAll<HTMLAnchorElement>('.home-appointment')
  expect(appointments).toHaveLength(2)
  expect(appointments[0]).toHaveTextContent('Endocrinologista')
  expect(appointments[0]).toHaveTextContent('Dra. Ana')
  expect(appointments[0]).toHaveAttribute('href', `/detalhes/appointments/${first.id}`)
  expect(appointments[1]).toHaveTextContent('Nutricionista')
  expect(appointments[1]).toHaveTextContent('Profissional com nome longo para celular')
  expect(screen.getAllByRole('link', { name: 'Ver histórico' }).find(link => link.getAttribute('href') === '/historico?tipo=appointments')).toBeTruthy()
})

it('mostra uma única consulta futura ou o estado vazio sem incluir consultas passadas', async () => {
  const past = stamp({ at: new Date(Date.now() - 86400000).toISOString(), attendanceType: 'general' as const })
  const future = stamp({ at: new Date(Date.now() + 86400000).toISOString(), attendanceType: 'ophthalmologist' as const })
  await db.appointments.bulkAdd([past, future])
  const view = open('/')
  await screen.findAllByText('Oftalmologista')
  expect(document.querySelectorAll('.home-appointment')).toHaveLength(1)
  expect(screen.queryByText('Clínico geral')).toBeNull()
  view.unmount(); await db.appointments.delete(future.id)
  open('/')
  await screen.findByRole('heading', { name: 'Olá, Perfil de teste' })
  expect(screen.queryByRole('heading', { name: 'Próximas consultas' })).toBeNull()
  expect(screen.getAllByRole('link', { name: 'Ver histórico' }).find(link => link.getAttribute('href') === '/historico?tipo=appointments')).toBeUndefined()
})

it('identifica uma consulta futura no dia atual como Hoje', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 3, 10, 9, 0))
  await db.appointments.add(stamp({ at: new Date(2026, 3, 10, 16, 0).toISOString(), attendanceType: 'general' as const }))
  open('/')
  await screen.findByText('Próximas consultas')
  expect((await screen.findAllByText(/^Hoje, 10\/04\/2026 às 16:00$/))).toHaveLength(2)
})

it('destaca somente a consulta mais próxima dentro das próximas 24 horas', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 3, 10, 15, 15))
  const first = stamp({ at: new Date(2026, 3, 10, 17, 0).toISOString(), attendanceType: 'endocrinologist' as const, professional: 'Dra. Ana' })
  const second = stamp({ at: new Date(2026, 3, 10, 18, 0).toISOString(), attendanceType: 'nutritionist' as const })
  await db.appointments.bulkAdd([second, first]); await db.glucose.add(stamp({ value: 115, at: new Date(2026, 3, 10, 15, 0).toISOString() }))
  open('/')
  const title = await screen.findByText('Consulta em breve')
  const highlight = title.closest('.imminent-appointment')!
  expect(highlight).toHaveTextContent('Endocrinologista')
  expect(highlight).toHaveTextContent('Hoje, 10/04/2026 às 17:00')
  expect(highlight).toHaveTextContent('em 1h45min')
  expect(highlight).toHaveAttribute('href', `/detalhes/appointments/${first.id}`)
  expect(highlight.compareDocumentPosition(screen.getByText('Última medição').closest('section')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
})

it('não destaca consultas sem proximidade ou quando não há consultas futuras', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 3, 10, 15, 15))
  await db.appointments.add(stamp({ at: new Date(2026, 3, 11, 16, 0).toISOString(), attendanceType: 'general' as const }))
  open('/')
  await screen.findByText('Próximas consultas')
  expect(document.querySelector('.imminent-appointment')).toBeNull()
})

it('remove automaticamente da Home a consulta que acabou de passar', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 3, 10, 9, 0))
  await db.appointments.add(stamp({ at: new Date(2026, 3, 10, 9, 0, 30).toISOString(), attendanceType: 'general' as const }))
  open('/')
  await screen.findByText('Próximas consultas')
  vi.setSystemTime(new Date(2026, 3, 10, 9, 1))
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  expect(screen.queryByRole('heading', { name: 'Próximas consultas' })).toBeNull()
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

it('confirma a exclusão no cartão de detalhes e preserva referências sem cascata', async () => {
  const meal = stamp({ kind: 'Almoço', at: now() }); const glucose = stamp({ value: 123, at: now(), mealId: meal.id })
  await db.meals.add(meal); await db.glucose.add(glucose)
  open('/detalhes/meals/' + meal.id)
  expect(await screen.findByRole('heading', { name: 'Refeição' })).toBeInTheDocument()
  expect(document.querySelector('.details-heading')).toBeTruthy()
  expect(document.querySelector('.details-actions')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('Excluir este registro?')
  expect(dialog).toHaveTextContent('Esta ação não poderá ser desfeita.')
  await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
  expect(await db.meals.get(meal.id)).toEqual(meal)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Excluir' }))
  await userEvent.click(screen.getByRole('button', { name: 'Excluir registro' }))
  await waitFor(async () => expect(await db.meals.get(meal.id)).toBeUndefined())
  expect(await db.glucose.get(glucose.id)).toEqual(glucose)
  expect(await screen.findByRole('status')).toHaveTextContent('Registro excluído deste dispositivo.')
})

it('mantém o registro e informa falha se a exclusão local não persistir', async () => {
  const meal = stamp({ kind: 'Almoço', at: now() }); await db.meals.add(meal)
  vi.spyOn(db.meals, 'delete').mockRejectedValueOnce(new Error('IndexedDB indisponível'))
  open('/detalhes/meals/' + meal.id)
  await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  await userEvent.click(screen.getByRole('button', { name: 'Excluir registro' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível excluir o registro')
  expect(await db.meals.get(meal.id)).toEqual(meal)
})

it('informa falha de leitura sem redirecionar para cadastro ou sobrescrever perfil', async () => {
  vi.spyOn(db.profiles, 'get').mockRejectedValueOnce(new Error('IndexedDB indisponível'))
  open('/'); expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento local está indisponível')
  expect(screen.queryByText('Vamos começar pelo essencial.')).toBeNull()
  expect((await db.profiles.get('local'))?.name).toBe('Perfil de teste')
})
