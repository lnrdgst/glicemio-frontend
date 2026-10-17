import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'
import { db, now, stamp } from '../database/db'
import { classifyGlucose, glucoseSummary, hypoglycemiaGuidance } from './glucose'

it.each([
  [53, 'hypoglycemia-level-2'], [54, 'hypoglycemia-level-1'], [69, 'hypoglycemia-level-1'], [70, 'below-range'], [79, 'below-range'], [80, 'in-range'], [130, 'in-range'], [131, 'intermediate'], [170, 'intermediate'], [171, 'attention'], [299, 'attention'], [300, 'high-attention'], [301, 'high-attention'],
])('classifica %s mg/dL como %s', (value, id) => expect(classifyGlucose(value)).toMatchObject({ id }))

it('trata valores inválidos e não atribui hipoglicemia clínica nível 3', () => {
  expect(classifyGlucose(Number.NaN)).toMatchObject({ id: 'invalid' })
  expect(classifyGlucose(-1)).toMatchObject({ id: 'invalid' })
  expect(hypoglycemiaGuidance(classifyGlucose(70))).toBeUndefined()
  expect(hypoglycemiaGuidance(classifyGlucose(53))).toMatch(/Atenção alta/)
})

it('calcula mínima, máxima e média aritmética simples de forma centralizada', () => {
  expect(glucoseSummary([])).toBeUndefined()
  expect(glucoseSummary([80, 120, 160])).toEqual({ minimum: 80, maximum: 160, average: 120 })
})

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('atualiza o cartão da Home após novo registro e edição sem alterar o registro', async () => {
  const record = stamp({ value: 65, at: now(), context: 'Jejum' }); await db.glucose.add(record)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('Hipoglicemia nível 1')).toBeInTheDocument()
  expect(screen.getByText(/plano individual de tratamento da hipoglicemia/i)).toBeInTheDocument()
  await db.glucose.put({ ...record, value: 115, updatedAt: now() })
  expect(await screen.findByText('Dentro da faixa definida')).toBeInTheDocument()
  expect(screen.queryByText(/plano individual de tratamento da hipoglicemia/i)).toBeNull()
  expect(await db.glucose.get(record.id)).toMatchObject({ id: record.id, createdAt: record.createdAt, value: 115, context: 'Jejum' })
})

it('mantém o vínculo com a refeição sem exibir a informação redundante na Home', async () => {
  const meal = stamp({ kind: 'Almoço', at: now() }); await db.meals.add(meal)
  const glucose = stamp({ value: 115, at: now(), context: 'Após refeição', mealId: meal.id }); await db.glucose.add(glucose)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('Após refeição', { exact: false })).toBeInTheDocument()
  expect(screen.queryByText('Associada a uma refeição')).toBeNull()
  expect((await db.glucose.get(glucose.id))?.mealId).toBe(meal.id)
  const history = screen.getAllByRole('link', { name: /Ver histórico/ }).find(link => link.getAttribute('href') === '/historico?tipo=glucose')!
  expect(history.closest('.home-history')).toBeTruthy()
  expect(history.closest('.glucose-card')).toBeNull()
  const section = history.closest('.home-section')!
  expect(section).toHaveClass('glucose-section')
  expect(section.querySelector('.glucose-card')).toBeTruthy()
})

it('mostra as últimas aplicações basal e rápida anteriores à glicemia, sem incluir aplicações posteriores', async () => {
  const glucose = stamp({ value: 115, at: '2026-10-17T12:00:00.000Z' })
  const basal = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: '2026-10-17T08:00:00.000Z', medicationName: 'Lantus' })
  const rapid = stamp({ kind: 'Rápida' as const, dose: 4.5, at: '2026-10-17T11:30:00.000Z', medicationName: 'NovoRapid' })
  const later = stamp({ kind: 'Basal/lenta' as const, dose: 20, at: '2026-10-17T13:00:00.000Z', medicationName: 'Tresiba' })
  await db.glucose.add(glucose); await db.insulin.bulkAdd([basal, rapid, later])
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const context = await screen.findByLabelText('Últimas aplicações anteriores à medição')
  expect(context).toHaveTextContent('Basal')
  expect(context).toHaveTextContent('Lantus')
  expect(context).toHaveTextContent('18 UI')
  expect(context).toHaveTextContent('Rápida')
  expect(context).toHaveTextContent('NovoRapid')
  expect(context).toHaveTextContent('4,5 UI')
  expect(context).not.toHaveTextContent('Tresiba')
  expect(screen.queryByRole('heading', { name: 'Últimas aplicações de insulina' })).toBeNull()
  expect(screen.getByRole('link', { name: /Basal.*Lantus/i })).toHaveAttribute('href', `/detalhes/insulin/${basal.id}`)
})

it('exibe somente a aplicação rápida elegível e oculta o contexto sem aplicações anteriores', async () => {
  const glucose = stamp({ value: 115, at: '2026-10-17T12:00:00.000Z' })
  const rapid = stamp({ kind: 'Rápida' as const, dose: 3, at: '2026-10-17T12:00:00.000Z', medicationName: 'Humalog' })
  await db.glucose.add(glucose); await db.insulin.add(rapid)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const context = await screen.findByLabelText('Últimas aplicações anteriores à medição')
  expect(context).toHaveTextContent('Rápida')
  expect(context).not.toHaveTextContent('Basal')
  await db.insulin.delete(rapid.id)
  await waitFor(() => expect(screen.queryByLabelText('Últimas aplicações anteriores à medição')).toBeNull())
})

it('exibe resumo somente com duas ou mais glicemias do dia local e atualiza após exclusão', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 15, 18, 0))
  const yesterday = stamp({ value: 240, at: new Date(2026, 9, 14, 22, 0).toISOString() })
  const first = stamp({ value: 80, at: new Date(2026, 9, 15, 8, 0).toISOString() })
  const latest = stamp({ value: 160, at: new Date(2026, 9, 15, 17, 38).toISOString(), context: 'Não informado' })
  await db.glucose.bulkAdd([yesterday, first, latest])
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const summary = await screen.findByLabelText('Resumo glicêmico de hoje')
  expect(summary).toHaveTextContent('Resumo de hoje')
  expect(summary).toHaveTextContent('2 medições')
  expect(summary).toHaveTextContent('Mínima80 mg/dL')
  expect(summary).toHaveTextContent('Máxima160 mg/dL')
  expect(summary).toHaveTextContent('Média120 mg/dL')
  expect(screen.queryByRole('link', { name: /gráfico completo de evolução recente/i })).toBeNull()
  expect(screen.queryByText('Sem contexto')).toBeNull()
  expect(screen.getByRole('link', { name: /160 mg\/dL/i })).not.toHaveTextContent(/registrada/)

  await db.glucose.delete(first.id)
  await waitFor(() => expect(screen.queryByLabelText('Resumo glicêmico de hoje')).toBeNull())
})

it('mantém a última medição anterior e oculta resumo sem medições suficientes hoje', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 15, 9, 0))
  await db.glucose.add(stamp({ value: 115, at: new Date(2026, 9, 14, 21, 45).toISOString(), context: 'Jejum' }))
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('115', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('Jejum')).toBeInTheDocument()
  expect(screen.queryByLabelText('Resumo glicêmico de hoje')).toBeNull()
})
