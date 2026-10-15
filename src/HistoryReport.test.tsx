import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'
import { eventDateTime } from './shared/format'

const open = (route: string) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString()

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('formata Hoje, Ontem e datas anteriores pelo calendário local', () => {
  const reference = new Date(2026, 9, 15, 0, 5)
  expect(eventDateTime(new Date(2026, 9, 15, 0, 1).toISOString(), reference)).toBe('Hoje, às 00:01')
  expect(eventDateTime(new Date(2026, 9, 14, 23, 59).toISOString(), reference)).toBe('Ontem, às 23:59')
  expect(eventDateTime(new Date(2026, 9, 13, 23, 59).toISOString(), reference)).toBe('13/10/2026 às 23:59')
})

it('separa a timeline em Hoje, Ontem e data completa', async () => {
  const current = new Date(); const today = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 10); const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1, 10); const older = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 2, 10)
  await db.glucose.bulkAdd([stamp({ value: 100, at: today.toISOString() }), stamp({ value: 101, at: yesterday.toISOString() }), stamp({ value: 102, at: older.toISOString() })])
  open('/historico')
  await screen.findByRole('link', { name: /100 mg\/dL/ })
  expect(screen.getByText(/Hoje ·/)).toBeInTheDocument()
  expect(screen.getByText(/Ontem ·/)).toBeInTheDocument()
  expect(screen.getByText(`${String(older.getDate()).padStart(2, '0')}/${String(older.getMonth() + 1).padStart(2, '0')}/${older.getFullYear()}`)).toBeInTheDocument()
})

it('agrupa o histórico por dia e carrega registros em lotes sem duplicação', async () => {
  await db.glucose.bulkAdd(Array.from({ length: 25 }, (_, index) => stamp({ value: 100 + index, at: minutesAgo(index) })))
  open('/historico')
  await screen.findByRole('link', { name: /100 mg\/dL/ })
  expect(screen.getByText(/Hoje ·/)).toBeInTheDocument()
  expect(document.querySelectorAll('.history-link')).toHaveLength(20)
  await userEvent.click(screen.getByRole('button', { name: 'Carregar registros anteriores' }))
  await waitFor(() => expect(document.querySelectorAll('.history-link')).toHaveLength(25))
  expect(screen.queryByRole('button', { name: 'Carregar registros anteriores' })).toBeNull()
  const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('.history-link')].map(link => link.getAttribute('href'))
  expect(new Set(hrefs).size).toBe(25)
})

it('aplica filtros antes da paginação e preserva a abertura dos detalhes', async () => {
  await db.glucose.bulkAdd(Array.from({ length: 21 }, (_, index) => stamp({ value: 100 + index, at: minutesAgo(index) })))
  const meal = stamp({ kind: 'Almoço', at: minutesAgo(1) }); await db.meals.add(meal)
  open('/historico'); await screen.findByRole('link', { name: /100 mg\/dL/ })
  await userEvent.click(screen.getByRole('button', { name: 'Refeições' }))
  expect(await screen.findByRole('link', { name: /Almoço/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /100 mg\/dL/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Carregar registros anteriores' })).toBeNull()
  await userEvent.click(screen.getByRole('link', { name: /Almoço/ }))
  expect(await screen.findByRole('link', { name: 'Editar' })).toHaveAttribute('href', `/refeicao/${meal.id}/editar`)
})

it('separa indicadores de glicemia, acontecimentos e estados vazios no relatório', async () => {
  open('/relatorio')
  expect(await screen.findByText('Nenhuma medição cadastrada neste período.')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /gráfico de glicemia/i })).toBeNull()
  await db.glucose.bulkAdd([stamp({ value: 90, at: minutesAgo(10) }), stamp({ value: 150, at: minutesAgo(20) })])
  await db.meals.add(stamp({ kind: 'Almoço', at: minutesAgo(30) }))
  await db.insulin.add(stamp({ kind: 'Rápida', dose: 4, at: minutesAgo(40) }))
  await waitFor(() => expect(screen.getByText('120 mg/dL')).toBeInTheDocument())
  expect(screen.getByText('Glicemia')).toBeInTheDocument()
  expect(screen.getByText('Acontecimentos registrados')).toBeInTheDocument()
  expect(screen.getByText(/média considera somente as medições cadastradas/i)).toBeInTheDocument()
})

it('mostra resumo compacto e gráfico de linha com pontos classificados', async () => {
  await db.glucose.bulkAdd([stamp({ value: 115, at: minutesAgo(10) }), stamp({ value: 188, at: minutesAgo(20) }), stamp({ value: 345, at: minutesAgo(30) })])
  open('/relatorio')
  await screen.findByText('216 mg/dL')
  const chart = await screen.findByRole('img', { name: 'Gráfico de glicemia com 3 medições' })
  expect(chart.querySelector('polyline')).toBeInTheDocument()
  expect(chart.querySelectorAll('circle')).toHaveLength(3)
  expect([...chart.querySelectorAll('circle')].map(point => point.getAttribute('fill'))).toEqual(['#CE6872', '#D98A60', '#71AFA5'])
})
