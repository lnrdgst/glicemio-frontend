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
import { postMealDismissalKey, postMealDismissalValue } from './shared/postMealReminder'
import * as reminderPolicy from './shared/postMealReminder'

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
  expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBe(postMealDismissalValue(meal))
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
  expect(localStorage.getItem(postMealDismissalKey(newer.id))).toBe(postMealDismissalValue(newer))
  expect(localStorage.getItem(postMealDismissalKey(older.id))).toBeNull()
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it.each(['hipoglicemia', 'atenção alta', 'basal', 'consulta'])('coexiste com %s, prioriza ações e mantém classificação no cartão', async priority => {
  await addMeal()
  if (priority === 'hipoglicemia') await db.glucose.add(stamp({ value: 50, at: new Date(base + 60 * minute).toISOString() }))
  if (priority === 'atenção alta') await db.glucose.add(stamp({ value: 320, at: new Date(base + 60 * minute).toISOString() }))
  if (priority === 'basal') await db.profiles.update('local', { basalReminderEnabled: true, basalReminderTime: '00:00' })
  if (priority === 'consulta') await db.appointments.add(stamp({ at: new Date(base + 180 * minute).toISOString() }))
  open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  const alert = priority === 'basal' ? await screen.findByText('Insulina basal — lembrete')
    : priority === 'consulta' ? await screen.findByText('Consulta em breve')
    : priority === 'hipoglicemia' ? await screen.findByText(/tratamento da hipoglicemia/)
    : await screen.findByText('Atenção alta')
  const reminder = await screen.findByText('Que tal registrar sua glicemia?')
  if (priority === 'atenção alta') {
    expect(document.querySelector('.glucose-card')).toContainElement(alert)
    expect(reminder.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  } else {
    expect(alert.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  const actions = screen.getByLabelText('Ações rápidas')
  expect(actions.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(reminder.compareDocumentPosition(document.querySelector('.glucose-section')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(reminder.closest('.home-notices')).toBeInTheDocument()
  expect(document.querySelector('.home-notices .glucose-status')).toBeNull()
  expect(document.querySelector('.home-notices')).not.toHaveTextContent('Última medição registrada:')
  expect(screen.getAllByLabelText('Lembrete de glicemia após refeição')).toHaveLength(1)
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
  const value = postMealDismissalValue(meal)
  localStorage.setItem(postMealDismissalKey(meal.id), value)
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: postMealDismissalKey(meal.id), newValue: value })) })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await tick(base + 240 * minute)
  const actions = screen.getByLabelText('Ações rápidas')
  await userEvent.click(within(actions).getByRole('link', { name: 'Registrar glicemia' }))
  expect(await screen.findByRole('button', { name: 'Salvar registro de glicemia' })).toBeEnabled()
})

it('invalida dispensa após correção efetiva do horário e preserva nova dispensa ao reabrir', async () => {
  const meal = await addMeal(); const view = open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  const at = new Date(base + 10 * minute).toISOString()
  await act(async () => { await db.meals.update(meal.id, { at }) })
  await screen.findByText('Que tal registrar sua glicemia?')
  await waitFor(() => expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBeNull())
  await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
  expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBe(postMealDismissalValue({ ...meal, at }))
  view.unmount(); open(); await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it.each([50, 250, 320])('não bloqueia refeição elegível pela última glicemia antiga de %s', async value => {
  await addMeal()
  await db.glucose.add(stamp({ value, at: new Date(base - 24 * 60 * minute).toISOString() }))
  const before = (await exportBackup()).data
  open()
  await screen.findByText(String(value))
  await screen.findByText('Que tal registrar sua glicemia?')
  expect((await exportBackup()).data).toEqual(before)
})

it('permite consulta nas próximas 24h, basal e pós-refeição simultâneos sem alterar os outros avisos', async () => {
  await addMeal()
  await db.profiles.update('local', { basalReminderEnabled: true, basalReminderTime: '00:00' })
  await db.appointments.add(stamp({ at: new Date(base + (150 + 20 * 60) * minute).toISOString() }))
  await db.glucose.add(stamp({ value: 320, at: new Date(base - 24 * 60 * minute).toISOString() }))
  const before = (await exportBackup()).data
  open()
  await screen.findByText('Consulta em breve')
  await screen.findByText('Insulina basal — lembrete')
  await screen.findByText('Atenção alta')
  expect(document.querySelector('.glucose-card .glucose-status')).toHaveTextContent('Atenção alta')
  expect(document.querySelector('.home-notices')).not.toHaveTextContent('Atenção alta')
  expect(await screen.findAllByLabelText('Lembrete de glicemia após refeição')).toHaveLength(1)
  await userEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
  expect(screen.getByText('Consulta em breve')).toBeInTheDocument()
  expect(screen.getByText('Insulina basal — lembrete')).toBeInTheDocument()
  expect(screen.getByText('Atenção alta')).toBeInTheDocument()
  expect(localStorage.getItem('glicoponto-basal-reminder')).toBeNull()
  expect((await exportBackup()).data).toEqual(before)
})

it.each(['descrição', 'instante equivalente'])('preserva dispensa após edição de %s e reabertura', async change => {
  const meal = await addMeal(), scheduled = vi.spyOn(reminderPolicy, 'nextPostMealCheck')
  const view = open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  const update = change === 'descrição'
    ? { description: 'Descrição corrigida', updatedAt: now() }
    : { at: new Date(base).toISOString().replace('Z', '+00:00') }
  await act(async () => { await db.meals.update(meal.id, update) })
  await waitFor(() => expect(scheduled).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: meal.id, ...update })]), expect.any(Number)))
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBe(postMealDismissalValue(meal))
  view.unmount(); scheduled.mockClear(); open()
  await waitFor(() => expect(scheduled).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: meal.id, ...update })]), expect.any(Number)))
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
})

it.each(['meal_end', 'unconfirmed'] as const)('invalida dispensa ao mudar referência para %s e reavalia retorno ao início', async timeReference => {
  const meal = await addMeal(), scheduled = vi.spyOn(reminderPolicy, 'nextPostMealCheck')
  open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  await act(async () => { await db.meals.update(meal.id, { timeReference }) })
  await waitFor(() => expect(scheduled).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: meal.id, timeReference })]), expect.any(Number)))
  await waitFor(() => expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBeNull())
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  await act(async () => { await db.meals.update(meal.id, { timeReference: 'meal_start' }) })
  await screen.findByText('Que tal registrar sua glicemia?')
})

it('reavalia correção de horário feita enquanto a Home estava desmontada', async () => {
  const meal = await addMeal(), view = open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  view.unmount()
  await db.meals.update(meal.id, { at: new Date(base + 15 * minute).toISOString() })
  open()
  await screen.findByText('Que tal registrar sua glicemia?')
})

it('não usa a dispensa antiga sem horário e referência para ocultar um evento', async () => {
  const meal = await addMeal()
  localStorage.setItem(postMealDismissalKey(meal.id), '1')
  open()
  await screen.findByText('Que tal registrar sua glicemia?')
  await waitFor(() => expect(localStorage.getItem(postMealDismissalKey(meal.id))).toBeNull())
})

it('preserva dispensa na virada de dia e reabertura, mantendo a expiração às 3h', async () => {
  const mealAt = Date.parse('2026-10-23T23:00:00-03:00')
  vi.setSystemTime(mealAt + 120 * minute)
  const meal = stamp({ kind: 'Jantar', at: new Date(mealAt).toISOString(), timeReference: 'meal_start' as const })
  await db.meals.add(meal)
  const scheduled = vi.spyOn(reminderPolicy, 'nextPostMealCheck'), first = open()
  await userEvent.click(await screen.findByRole('button', { name: 'Dispensar' }))
  first.unmount(); vi.setSystemTime(mealAt + 150 * minute); scheduled.mockClear(); open()
  await waitFor(() => expect(scheduled).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: meal.id })]), expect.any(Number)))
  expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
  // Outra refeição não dispensada atravessa o mesmo limite de dia normalmente.
  await act(async () => { await db.meals.add(stamp({ kind: 'Lanche', at: new Date(mealAt + minute).toISOString(), timeReference: 'meal_start' as const })) })
  await screen.findByText('Que tal registrar sua glicemia?')
  await tick(mealAt + 181 * minute)
  await waitFor(() => expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull())
})

const unconfirmedNote = 'Este horário ainda não foi identificado como início ou fim da refeição. Por isso, não gera lembretes de glicemia pós-refeição.'
it.each(['meal_start', 'meal_end', 'unconfirmed', undefined] as const)('orienta apenas referência não confirmada nos detalhes e edição: %s', async timeReference => {
  const meal = stamp({ kind: 'Almoço', at: new Date(base).toISOString(), timeReference })
  await db.meals.add(meal)
  const before = (await exportBackup()).data
  open(`/detalhes/meals/${meal.id}`)
  await screen.findByRole('heading', { name: 'Refeição' })
  const unknown = timeReference === undefined || timeReference === 'unconfirmed'
  expect(Boolean(screen.queryByText(unconfirmedNote))).toBe(unknown)
  await userEvent.click(screen.getByRole('link', { name: 'Editar' }))
  await screen.findByRole('heading', { name: 'Editar refeição' })
  expect(Boolean(screen.queryByText(unconfirmedNote))).toBe(unknown)
  expect((await exportBackup()).data).toEqual(before)
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
