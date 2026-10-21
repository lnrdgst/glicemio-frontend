import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now } from './database/db'

const renderApp = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

describe('onboarding', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('mostra o onboarding no primeiro acesso sem perfil', async () => {
    renderApp()
    expect(await screen.findByText('Vamos começar pelo essencial.')).toBeTruthy()
    expect(screen.getByText('Separe por vírgula ou por linha. Você poderá editar em Ajustes > Perfil.')).toBeTruthy()
  })

  it('salva um cadastro válido e apresenta a Home', async () => {
    const user = userEvent.setup()
    renderApp()
    await user.type(await screen.findByRole('textbox', { name: /como podemos chamar/i }), 'Ana')
    await user.click(screen.getByRole('button', { name: 'Concluir' }))
    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeTruthy()
    expect((await db.profiles.get('local'))?.name).toBe('Ana')
  })

  it('mantém o perfil e abre a Home após recarregar a aplicação', async () => {
    await db.profiles.put({ id: 'local', name: 'Beatriz', createdAt: now(), updatedAt: now() })
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Olá, Beatriz' })).toBeTruthy()
  })

  it('preserva alterações posteriores do perfil', async () => {
    await db.profiles.put({ id: 'local', name: 'Carla', createdAt: now(), updatedAt: now() })
    await db.profiles.update('local', { name: 'Carla Silva', updatedAt: now() })
    expect((await db.profiles.get('local'))?.name).toBe('Carla Silva')
  })

  it('informa erro e não conclui onboarding quando a persistência falha', async () => {
    const user = userEvent.setup()
    vi.spyOn(db.profiles, 'put').mockRejectedValueOnce(new Error('IndexedDB indisponível'))
    renderApp()
    await user.type(await screen.findByRole('textbox', { name: /como podemos chamar/i }), 'Dora')
    await user.click(screen.getByRole('button', { name: 'Concluir' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível salvar')
    await waitFor(() => expect(screen.getByText('Vamos começar pelo essencial.')).toBeTruthy())
    expect(await db.profiles.get('local')).toBeUndefined()
  })

  it('prioriza o lembrete basal ativo antes da última medição e não deixa espaço quando inativo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 15, 22, 0))
    await db.profiles.put({ id: 'local', name: 'Hugo', basalReminderEnabled: true, basalReminderTime: '21:00', createdAt: now(), updatedAt: now() })
    renderApp()
    const reminder = await screen.findByText('Insulina basal — lembrete')
    const glucose = await screen.findByRole('heading', { name: 'Nenhuma medição ainda' })
    expect(reminder.closest('.basal-reminder')!.compareDocumentPosition(glucose.closest('section')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    cleanup()
    await db.profiles.update('local', { basalReminderEnabled: false })
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Nenhuma medição ainda' })).toBeTruthy()
    expect(screen.queryByText('Insulina basal — lembrete')).toBeNull()
  })

  it('integra as ações de registro aos cartões da Home', async () => {
    await db.profiles.put({ id: 'local', name: 'Lia', createdAt: now(), updatedAt: now() })
    renderApp()
    const quickAction = (name: string) => within(quickActions).getByRole('link', { name })
    expect(quickAction('Registrar glicemia').getAttribute('href')).toBe('/glicemia')
    expect(quickAction('Registrar refeição').getAttribute('href')).toBe('/refeicao')
    expect(quickAction('Registrar insulina').getAttribute('href')).toBe('/insulina')
    expect(quickAction('Registrar treino').getAttribute('href')).toBe('/treino')
    expect(quickAction('Registrar consulta').getAttribute('href')).toBe('/consulta')
    expect(quickAction('Registrar sintomas').getAttribute('href')).toBe('/episodio')
    const glucose = screen.getAllByRole('link', { name: 'Registrar glicemia' }).find(link => link.classList.contains('home-add-glucose'))!
    const meal = screen.getAllByRole('link', { name: 'Registrar refeição' }).find(link => link.classList.contains('home-add-meal'))!
    const insulin = screen.getAllByRole('link', { name: 'Registrar insulina' }).find(link => link.classList.contains('home-add-insulin'))!
    const workout = screen.getAllByRole('link', { name: 'Registrar treino' }).find(link => link.classList.contains('home-add-workout'))!
    const appointment = screen.getAllByRole('link', { name: 'Registrar consulta' }).find(link => link.classList.contains('home-add-appointment'))!
    expect(glucose).toBeTruthy()
    expect(meal).toBeTruthy()
    expect(insulin).toBeTruthy()
    expect(workout).toBeTruthy()
    expect(appointment.getAttribute('href')).toBe('/consulta')
    expect(appointment.className).toContain('home-add-appointment')
    expect(screen.getByRole('link', { name: 'Estou com sintomas' }).className).toContain('symptoms-action')
    expect(screen.getByText('Nenhuma consulta futura.')).toBeTruthy()
    await userEvent.click(appointment)
    expect(await screen.findByRole('heading', { name: 'Nova consulta' })).toBeTruthy()
  })
})
