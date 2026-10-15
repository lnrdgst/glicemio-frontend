import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'

const renderApp = () => render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

describe('onboarding', () => {
  beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('mostra o onboarding no primeiro acesso sem perfil', async () => {
    renderApp()
    expect(await screen.findByText('Vamos começar pelo essencial.')).toBeTruthy()
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

  it('mostra a última aplicação basal/lenta', async () => {
    await db.profiles.put({ id: 'local', name: 'Elisa', createdAt: now(), updatedAt: now() })
    await db.insulin.bulkAdd([
      stamp({ kind: 'Basal/lenta', dose: 10, at: '2026-01-01T09:00:00.000Z' }),
      stamp({ kind: 'Basal/lenta', dose: 22, at: '2026-01-01T21:00:00.000Z' }),
    ])
    renderApp()
    expect(await screen.findByText('22 UI')).toBeTruthy()
    expect(screen.queryByText('10 UI')).toBeNull()
  })

  it('mostra a última aplicação rápida', async () => {
    await db.profiles.put({ id: 'local', name: 'Fábio', createdAt: now(), updatedAt: now() })
    await db.insulin.add(stamp({ kind: 'Rápida', dose: 4.5, at: '2026-01-01T12:15:00.000Z' }))
    renderApp()
    expect(await screen.findByText('4,5 UI')).toBeTruthy()
  })

  it('ordena aplicações pela data efetiva, não pela criação', async () => {
    await db.profiles.put({ id: 'local', name: 'Gabi', createdAt: now(), updatedAt: now() })
    await db.insulin.add({ ...stamp({ kind: 'Rápida', dose: 7, at: '2026-01-01T08:00:00.000Z' }), createdAt: '2026-02-01T00:00:00.000Z' })
    await db.insulin.add({ ...stamp({ kind: 'Rápida', dose: 9, at: '2026-01-01T13:00:00.000Z' }), createdAt: '2026-01-01T00:00:00.000Z' })
    renderApp()
    expect(await screen.findByText('9 UI')).toBeTruthy()
    expect(screen.queryByText('7 UI')).toBeNull()
  })

  it('mostra um estado vazio compacto quando não há aplicações', async () => {
    await db.profiles.put({ id: 'local', name: 'Hugo', createdAt: now(), updatedAt: now() })
    renderApp()
    expect((await screen.findAllByText('Nenhuma aplicação registrada.')).length).toBe(1)
  })

  it('mantém os últimos registros basal e rápida independentes', async () => {
    await db.profiles.put({ id: 'local', name: 'Iara', createdAt: now(), updatedAt: now() })
    await db.insulin.bulkAdd([stamp({ kind: 'Basal/lenta', dose: 18, at: '2026-01-01T22:00:00.000Z' }), stamp({ kind: 'Rápida', dose: 3, at: '2026-01-01T12:00:00.000Z' })])
    renderApp()
    expect(await screen.findByText('18 UI')).toBeTruthy()
    expect(screen.getByText('3 UI')).toBeTruthy()
  })

  it('atualiza a Home quando uma nova aplicação é registrada', async () => {
    await db.profiles.put({ id: 'local', name: 'Joana', createdAt: now(), updatedAt: now() })
    renderApp()
    await screen.findAllByText('Nenhuma aplicação registrada.')
    await db.insulin.add(stamp({ kind: 'Rápida', dose: 6, at: '2026-01-01T12:00:00.000Z' }))
    expect(await screen.findByText('6 UI')).toBeTruthy()
  })

  it('mantém as ações rápidas e aplica classes de categoria para a paleta', async () => {
    await db.profiles.put({ id: 'local', name: 'Lia', createdAt: now(), updatedAt: now() })
    renderApp()
    expect((await screen.findByRole('link', { name: /Registrar glicemia/ })).className).toContain('quick-glucose')
    expect(screen.getByRole('link', { name: /Registrar refeição/ }).className).toContain('quick-meal')
    expect(screen.getByRole('link', { name: /Registrar insulina/ }).className).toContain('quick-insulin')
    expect(screen.getByRole('link', { name: /Registrar treino/ }).className).toContain('quick-workout')
    expect(screen.getByRole('link', { name: /Estou com sintomas/ }).className).toContain('quick-symptoms')
  })
})
