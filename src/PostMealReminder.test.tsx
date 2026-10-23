import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { PostMealReminder } from './PostMealReminder'
import { db, now, stamp } from './database/db'
import { exportBackup, previewBackup, restoreBackup } from './database/backup'
import { postMealDismissalKey } from './shared/postMealReminder'

const base = new Date(2026, 9, 23, 12).getTime(), minute = 60_000
const open = (route = '/') => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const addMeal = async (minutes = 0) => { const meal = stamp({ kind: 'Almoço', at: new Date(base + minutes * minute).toISOString(), timeReference: 'meal_start' as const }); await db.meals.add(meal); return meal }
const tick = async (timestamp: number) => { vi.setSystemTime(timestamp); await act(async () => { document.dispatchEvent(new Event('visibilitychange')) }) }
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(base + 150 * minute)
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  // O jsdom deste arquivo tem armazenamento isolado de dispositivos reais.
  localStorage.clear()
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('oferece o formulário existente sem associar nem alterar registros automaticamente', async () => {
  const meal = await addMeal(); const before = (await exportBackup()).data
  open(); const reminder = await screen.findByLabelText('Lembrete de glicemia após refeição')
  expect(within(reminder).getByText('Que tal registrar sua glicemia?')).toBeInTheDocument()
  const link = within(reminder).getByRole('link', { name: 'Registrar glicemia' })
  expect(link).toHaveAttribute('href', '/glicemia')
  expect((await exportBackup()).data).toEqual(before)
  await userEvent.click(link)
  expect(await screen.findByRole('button', { name: 'Salvar registro de glicemia' })).toBeEnabled()
  expect(await screen.findByLabelText('Associar a uma refeição (opcional)')).toHaveValue('')
  expect(await db.meals.get(meal.id)).toEqual(meal)
})

it('dispensa somente uma refeição, mantém a decisão após reabrir e não altera o banco', async () => {
  const meal = await addMeal(), before = (await exportBackup()).data
  const first = open(); await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBe('1')
  first.unmount(); open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  expect((await exportBackup()).data).toEqual(before)
})

it('recalcula ao entrar e sair da janela, inclusive após voltar à aplicação', async () => {
  await addMeal(); vi.setSystemTime(base + 120 * minute - 1); open()
  await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await tick(base + 120 * minute)
  await screen.findByText('Que tal registrar sua glicemia?')
  await tick(base + 180 * minute)
  await waitFor(() => expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull())
})

it('remove automaticamente no limite de 3 horas sem interação', async () => {
  await addMeal(); vi.setSystemTime(base + 180 * minute - 1000)
  render(<MemoryRouter><PostMealReminder enabled /></MemoryRouter>)
  await screen.findByText('Que tal registrar sua glicemia?')
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it('respeita medições por horário sem mealId e reage a edição da medição', async () => {
  await addMeal(); const glucose = stamp({ value: 110, at: new Date(base + 95 * minute).toISOString() }); await db.glucose.add(glucose)
  open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await act(async () => { await db.glucose.update(glucose.id, { at: new Date(base + 60 * minute).toISOString() }) })
  await screen.findByText('Que tal registrar sua glicemia?')
  await act(async () => { await db.glucose.update(glucose.id, { at: new Date(base + 90 * minute).toISOString() }) })
  await waitFor(() => expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull())
  expect((await db.glucose.get(glucose.id))?.mealId).toBeUndefined()
})

it('reage a edição de at ou da referência e considera refeição elegível além das três linhas da Home', async () => {
  const meal = await addMeal(); await addMeal(100); await addMeal(110); await addMeal(120)
  open(); await screen.findByText('Que tal registrar sua glicemia?')
  await act(async () => { await db.meals.update(meal.id, { timeReference: 'meal_end' }) })
  await waitFor(() => expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull())
  await act(async () => { await db.meals.update(meal.id, { timeReference: 'meal_start', at: new Date(base + 60 * minute).toISOString() }) })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await act(async () => { await db.meals.update(meal.id, { at: new Date(base).toISOString() }) })
  await screen.findByText('Que tal registrar sua glicemia?')
})

it('não encadeia avisos simultâneos para refeições próximas', async () => {
  const older = await addMeal(); const newer = await addMeal(20)
  open(); expect(await screen.findAllByLabelText('Lembrete de glicemia após refeição')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
  expect(localStorage.getItem(postMealDismissalKey(newer.id))).toBe('1')
  expect(localStorage.getItem(postMealDismissalKey(older.id))).toBeNull()
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it.each(['hipoglicemia', 'atenção alta', 'basal', 'consulta'])('cede o espaço ao aviso de %s', async priority => {
  await addMeal()
  if (priority === 'hipoglicemia') await db.glucose.add(stamp({ value: 50, at: new Date(base + 60 * minute).toISOString() }))
  if (priority === 'atenção alta') await db.glucose.add(stamp({ value: 320, at: new Date(base + 60 * minute).toISOString() }))
  if (priority === 'basal') await db.profiles.update('local', { basalReminderEnabled: true, basalReminderTime: '00:00' })
  if (priority === 'consulta') await db.appointments.add(stamp({ at: new Date(base + 180 * minute).toISOString() }))
  open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  if (priority === 'basal') await screen.findByText('Insulina basal — lembrete')
  if (priority === 'consulta') await screen.findByText('Consulta em breve')
  if (priority === 'hipoglicemia') await screen.findByText(/tratamento da hipoglicemia/)
  if (priority === 'atenção alta') await screen.findByText('Atenção alta')
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it('permite desativar nos Ajustes, preserva a preferência no backup e aceita perfil antigo', async () => {
  await addMeal(); open('/mais')
  const toggle = await screen.findByRole('checkbox', { name: 'Lembrete de glicemia após refeições' })
  expect(toggle).toBeChecked(); await userEvent.click(toggle)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
  await screen.findByText('Perfil salvo neste dispositivo.')
  expect((await db.profiles.get('local'))?.postMealReminderEnabled).toBe(false)
  const backup = await exportBackup(); expect(backup.data.profiles[0].postMealReminderEnabled).toBe(false)
  await db.profiles.clear(); await restoreBackup(await previewBackup(JSON.stringify(backup)), 'restore')
  expect((await db.profiles.get('local'))?.postMealReminderEnabled).toBe(false)
  cleanup(); open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  const legacy = structuredClone(backup.data); delete legacy.profiles[0].postMealReminderEnabled
  await db.profiles.clear(); await restoreBackup(await previewBackup(JSON.stringify(legacy)), 'restore')
  expect((await db.profiles.get('local'))?.postMealReminderEnabled).toBeUndefined()
})

it('respeita dispensa de outra aba e mantém medições fora da janela disponíveis', async () => {
  const meal = await addMeal(); open(); await screen.findByText('Que tal registrar sua glicemia?')
  localStorage.setItem(postMealDismissalKey(meal.id), '1')
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: postMealDismissalKey(meal.id), newValue: '1' })) })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await tick(base + 240 * minute)
  const actions = screen.getByLabelText('Ações rápidas')
  await userEvent.click(within(actions).getByRole('link', { name: 'Registrar glicemia' }))
  expect(await screen.findByRole('button', { name: 'Salvar registro de glicemia' })).toBeEnabled()
})

it('não reapresenta uma dispensa depois de editar o horário e reabrir a aplicação', async () => {
  const meal = await addMeal(); const view = open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  await db.meals.update(meal.id, { at: new Date(base + 10 * minute).toISOString() })
  view.unmount(); open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it('mantém dispensa nesta abertura se localStorage falhar, sem falhar o registro clínico', async () => {
  await addMeal(); open(); await screen.findByText('Que tal registrar sua glicemia?')
  const before = (await exportBackup()).data
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Armazenamento indisponível') })
  await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Não foi possível salvar a dispensa')
  expect((await exportBackup()).data).toEqual(before)
})

it('rejeita preferência inválida no backup sem modificar o perfil existente', async () => {
  const backup = await exportBackup(), before = structuredClone(backup.data.profiles)
  const invalid = JSON.parse(JSON.stringify(backup)); invalid.data.profiles[0].postMealReminderEnabled = 'false'
  await expect(previewBackup(JSON.stringify(invalid))).rejects.toThrow(/inválidos/)
  expect((await exportBackup()).data.profiles).toEqual(before)
})
