import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'
import { exportBackup } from './database/backup'
import { eventDateTime } from './shared/format'

const open = (route = '/') => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const at = (day: number, hour = 0, minute = 0, second = 0, ms = 0) => new Date(2026, 9, day, hour, minute, second, ms).toISOString()
const reportValues = () => [...document.querySelectorAll('.glucose-summary dd')].map(node => node.textContent)
const eventCounts = () => [...document.querySelectorAll('.report-cards h3')].map(node => node.textContent)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 24, 13))
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('abre Hoje pelo resumo inteiro via teclado, preservando estatísticas e levando ao topo', async () => {
  await db.glucose.bulkAdd([
    stamp({ value: 250, at: at(23, 23, 59, 59, 999) }),
    stamp({ value: 80, at: at(24) }),
    stamp({ value: 160, at: at(24, 13) }),
    stamp({ value: 350, at: at(24, 13, 0, 0, 1) }),
  ])
  open()
  const summary = await screen.findByRole('link', { name: 'Resumo glicêmico de hoje' })
  expect(summary).toHaveAttribute('href', '/relatorio?period=today')
  expect(summary).toHaveTextContent('2 medições')
  expect(summary).toHaveTextContent('Mínima80 mg/dL')
  expect(summary).toHaveTextContent('Máxima160 mg/dL')
  expect(summary).toHaveTextContent('Média120 mg/dL')
  expect(summary.querySelectorAll('a, button, input, select, [tabindex]')).toHaveLength(0)
  expect(within(summary).getByText('Resumo de hoje').querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByRole('img', { name: /Gráfico de glicemia/ })).toBeNull()
  vi.mocked(window.scrollTo).mockClear()
  summary.focus(); await userEvent.keyboard('{Enter}')
  expect(await screen.findByLabelText('Período')).toHaveValue('today')
  expect(await screen.findByRole('img', { name: 'Gráfico de glicemia com 2 medições' })).toBeInTheDocument()
  expect(reportValues()).toEqual(['2', '80 mg/dL', '160 mg/dL', '120 mg/dL'])
  expect(screen.getByRole('link', { name: 'Relatório' })).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' }))
  await userEvent.click(screen.getByRole('button', { name: /Ver detalhes da medição de 80 mg\/dL/i }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('24/10/2026 às 00:00')
  await userEvent.click(screen.getByRole('button', { name: /Ver detalhes da medição de 160 mg\/dL/i }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('24/10/2026 às 13:00')
  for (const period of ['7', '30', '90']) {
    await userEvent.selectOptions(screen.getByLabelText('Período'), period)
    expect(await screen.findByRole('img', { name: 'Gráfico de glicemia com 4 medições' })).toBeInTheDocument()
    expect(screen.getByLabelText('Período')).toHaveValue(period)
  }
  await userEvent.selectOptions(screen.getByLabelText('Período'), 'today')
  expect(await screen.findByRole('img', { name: 'Gráfico de glicemia com 2 medições' })).toBeInTheDocument()
  expect(reportValues()).toEqual(['2', '80 mg/dL', '160 mg/dL', '120 mg/dL'])
})

it('aplica os mesmos limites aos acontecimentos, sem modificar registros ou backups', async () => {
  const timestamps = [at(23, 23, 59, 59, 999), at(24), at(24, 13), at(24, 13, 0, 0, 1)]
  for (const timestamp of timestamps) {
    await db.meals.add(stamp({ kind: 'Almoço', at: timestamp }))
    await db.insulin.add(stamp({ kind: 'Rápida', dose: 1, at: timestamp }))
    await db.workouts.add(stamp({ activity: 'Caminhada', startedAt: timestamp }))
    await db.episodes.add(stamp({ symptoms: ['Tremor'], startedAt: timestamp }))
  }
  await db.meals.add(stamp({ kind: 'Excluída', at: at(24, 12), deletedAt: now() }))
  const before = (await exportBackup()).data
  open('/relatorio?period=today')
  await screen.findByText('Nenhuma medição cadastrada hoje.')
  expect(eventCounts()).toEqual(['2', '2', '2', '2'])
  expect((await exportBackup()).data).toEqual(before)
})

it('Hoje vazio não usa medições anteriores nem futuras e permite trocar normalmente o período', async () => {
  await db.glucose.bulkAdd([stamp({ value: 120, at: at(23, 23, 59) }), stamp({ value: 180, at: at(24, 14) })])
  open('/relatorio?period=today')
  await screen.findByText('Nenhuma medição cadastrada hoje.')
  expect(screen.queryByRole('img', { name: /Gráfico de glicemia/ })).toBeNull()
  expect(reportValues()).toEqual(['0', '—', '—', '—'])
  expect(eventCounts()).toEqual(['0', '0', '0', '0'])
  await userEvent.selectOptions(screen.getByLabelText('Período'), '7')
  expect(await screen.findByRole('img', { name: 'Gráfico de glicemia com 2 medições' })).toBeInTheDocument()
})

it('atualiza Hoje ao retomar a PWA após meia-noite, sem reutilizar estatísticas de ontem', async () => {
  vi.setSystemTime(new Date(2026, 9, 24, 23, 59))
  await db.glucose.bulkAdd([stamp({ value: 80, at: at(24, 8) }), stamp({ value: 160, at: at(24, 12) })])
  open()
  await userEvent.click(await screen.findByRole('link', { name: 'Resumo glicêmico de hoje' }))
  await screen.findByRole('img', { name: 'Gráfico de glicemia com 2 medições' })
  vi.setSystemTime(new Date(2026, 9, 25, 0, 1))
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
  await screen.findByText('Nenhuma medição cadastrada hoje.')
  expect(reportValues()).toEqual(['0', '—', '—', '—'])
  await act(async () => { await db.glucose.add(stamp({ value: 110, at: at(25) })) })
  await screen.findByRole('img', { name: 'Gráfico de glicemia com 1 medição' })
  expect(reportValues()).toEqual(['1', '110 mg/dL', '110 mg/dL', '110 mg/dL'])
  await userEvent.click(screen.getByRole('link', { name: 'Início' }))
  await screen.findByRole('heading', { name: 'Olá, Teste' })
  expect(screen.queryByRole('link', { name: 'Resumo glicêmico de hoje' })).toBeNull()
})

it('inclui uma nova medição até o instante atual sem esperar o próximo pulso do relógio', async () => {
  await db.glucose.bulkAdd([stamp({ value: 80, at: at(24, 8) }), stamp({ value: 160, at: at(24, 12) })])
  open()
  expect(await screen.findByRole('link', { name: 'Resumo glicêmico de hoje' })).toHaveTextContent('2 medições')
  vi.setSystemTime(new Date(2026, 9, 24, 13, 0, 1))
  await act(async () => { await db.glucose.add(stamp({ value: 120, at: now() })) })
  await waitFor(() => expect(screen.getByRole('link', { name: 'Resumo glicêmico de hoje' })).toHaveTextContent('3 medições'))
  await userEvent.click(screen.getByRole('link', { name: 'Resumo glicêmico de hoje' }))
  await screen.findByRole('img', { name: 'Gráfico de glicemia com 3 medições' })
  expect(reportValues()).toEqual(['3', '80 mg/dL', '160 mg/dL', '120 mg/dL'])
  vi.setSystemTime(new Date(2026, 9, 24, 13, 0, 2))
  await act(async () => { await db.glucose.add(stamp({ value: 140, at: now() })) })
  await screen.findByRole('img', { name: 'Gráfico de glicemia com 4 medições' })
})

it('retira o resumo da Home na virada de dia enquanto a tela permanece aberta', async () => {
  await db.glucose.bulkAdd([stamp({ value: 80, at: at(24, 8) }), stamp({ value: 160, at: at(24, 12) })])
  open()
  await screen.findByRole('link', { name: 'Resumo glicêmico de hoje' })
  vi.setSystemTime(new Date(2026, 9, 25))
  fireEvent(window, new Event('focus'))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Resumo glicêmico de hoje' })).toBeNull())
  expect(screen.getByRole('link', { name: /160 mg\/dL/ })).toBeInTheDocument()
})

it.each(['meal_start', 'meal_end', 'unconfirmed', undefined] as const)('resume refeição %s somente na Home, preservando detalhes e dados', async timeReference => {
  const meal = stamp({ kind: 'Almoço', at: at(24, 12), timeReference, description: 'Descrição preservada' })
  await db.meals.add(meal)
  open()
  const link = await screen.findByRole('link', { name: /Almoço/ })
  expect(link).toHaveTextContent(`Almoço${eventDateTime(meal.at)}`)
  expect(link.querySelector('.meal-record-info')?.children).toHaveLength(2)
  expect(link.querySelector('.meal-time-reference')).toBeNull()
  expect(link).toHaveAttribute('href', `/detalhes/meals/${meal.id}`)
  expect(screen.getByRole('link', { name: 'Últimas refeições' })).toHaveAttribute('href', '/historico?tipo=meals')
  await userEvent.click(link)
  const label = timeReference === 'meal_start' ? 'Início da refeição' : timeReference === 'meal_end' ? 'Fim da refeição' : 'Referência não confirmada'
  expect(await screen.findByText(label, { exact: false })).toBeInTheDocument()
  expect(screen.getByText('Descrição preservada')).toBeInTheDocument()
  expect(await db.meals.get(meal.id)).toEqual(meal)
})
