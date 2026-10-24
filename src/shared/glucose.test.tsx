import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

it.each([
  [115, 'Dentro da faixa definida', '#71AFA5'],
  [75, 'Abaixo da faixa definida', '#D5B45F'],
  [201, 'Atenção', '#D98A60'],
  [320, 'Atenção alta', '#CE6872'],
  [65, 'Hipoglicemia nível 1', '#CE6872'],
  [50, 'Hipoglicemia nível 2 — Atenção alta', '#A93347'],
  [150, 'Intermediária', '#D5B45F'],
  [-1, 'Valor inválido', '#B9AFA8'],
] as const)('exibe %s mg/dL com classificação única no cartão, após contexto e antes do resumo', async (value, label, color) => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 24, 18))
  const meal = stamp({ kind: 'Almoço', at: new Date(2026, 9, 24, 12).toISOString() })
  const record = stamp({ value, at: new Date(2026, 9, 24, 16, 37).toISOString(), context: 'Após refeição', mealId: meal.id })
  await db.meals.add(meal)
  await db.glucose.bulkAdd([stamp({ value: 100, at: new Date(2026, 9, 24, 8).toISOString() }), record])
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const summary = await screen.findByRole('link', { name: 'Resumo glicêmico de hoje' })
  await screen.findByText('Após refeição · Almoço')
  const card = summary.closest<HTMLElement>('.glucose-card')!
  const status = within(card).getByText(label, { exact: true })
  const detail = card.querySelector('.home-glucose-detail')!
  expect(card.style.getPropertyValue('--glucose-status-color')).toBe(color)
  expect(document.querySelectorAll('.glucose-status')).toHaveLength(1)
  expect(detail.lastElementChild).toBe(status)
  expect([...detail.children].map(child => child.textContent)).toEqual([
    `${value} mg/dL`, 'Hoje, às 16:37', 'Após refeição · Almoço', label,
  ])
  expect(detail.nextElementSibling).toBe(summary)
  expect(summary.nextElementSibling).toHaveAttribute('aria-label', 'Últimas aplicações registradas')
  expect(summary).toHaveAttribute('href', '/relatorio?period=today')
  const notices = document.querySelector('.home-notices')!
  expect(notices.querySelector('.glucose-status')).toBeNull()
  expect(notices).not.toHaveTextContent(/Última medição|mg\/dL|Hoje, às 16:37/)
  if (value === 50 || value === 65) {
    const guidance = screen.getByLabelText('Orientação de segurança para hipoglicemia')
    expect(notices).toContainElement(guidance)
    expect(guidance).toHaveTextContent(/siga.*plano individual de tratamento da hipoglicemia/i)
    expect(detail).toHaveAttribute('aria-describedby', guidance.id)
  } else {
    expect(notices).toBeEmptyDOMElement()
    expect(detail).not.toHaveAttribute('aria-describedby')
  }
  expect(await db.glucose.get(record.id)).toEqual(record)
})

it('não apresenta classificação ou orientação sem medições e preserva acesso ao cadastro', async () => {
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Nenhuma medição ainda' })
  expect(document.querySelector('.glucose-status')).toBeNull()
  expect(document.querySelector('.home-notices')).toBeEmptyDOMElement()
  expect(screen.queryByLabelText('Orientação de segurança para hipoglicemia')).toBeNull()
  const section = document.querySelector('.glucose-section')!
  expect(within(section as HTMLElement).getByRole('link', { name: 'Registrar glicemia' })).toHaveAttribute('href', '/glicemia')
})

it('atualiza o cartão da Home após novo registro e edição sem alterar o registro', async () => {
  const record = stamp({ value: 65, at: now(), context: 'Jejum' }); await db.glucose.add(record)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('Hipoglicemia nível 1')).toBeInTheDocument()
  const glucoseHeading = screen.getByText('Última medição').closest('.glucose-card-heading')!
  expect(glucoseHeading).toBeInTheDocument()
  expect(glucoseHeading).not.toHaveTextContent(/Hoje, às/)
  const glucoseDetail = screen.getByRole('link', { name: /65 mg\/dL/ })
  expect(glucoseDetail.querySelector('.glucose-card-date')).toHaveTextContent(/Hoje, às/)
  expect(screen.getByText(/plano individual de tratamento da hipoglicemia/i)).toBeInTheDocument()
  await db.glucose.put({ ...record, value: 115, updatedAt: now() })
  expect(await screen.findByText('Dentro da faixa definida')).toBeInTheDocument()
  expect(screen.queryByText(/plano individual de tratamento da hipoglicemia/i)).toBeNull()
  expect(await db.glucose.get(record.id)).toMatchObject({ id: record.id, createdAt: record.createdAt, value: 115, context: 'Jejum' })
})

it('exibe o contexto e a refeição vinculada à última medição na Home', async () => {
  const meal = stamp({ kind: 'Almoço', at: now() }); await db.meals.add(meal)
  const glucose = stamp({ value: 115, at: now(), context: 'Após refeição', mealId: meal.id }); await db.glucose.add(glucose)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('Após refeição · Almoço')).toBeInTheDocument()
  expect(screen.queryByText('Associada a uma refeição')).toBeNull()
  expect((await db.glucose.get(glucose.id))?.mealId).toBe(meal.id)
  const history = screen.getByRole('link', { name: 'Última medição' })
  expect(history).toHaveAttribute('href', '/historico?tipo=glucose')
  const section = history.closest('.home-section')!
  expect(section).toHaveClass('glucose-section')
  expect(section.querySelector('.glucose-card')).toBeTruthy()
})

it('preserva somente o contexto para associação ausente ou inválida e não infere contexto', async () => {
  const invalid = stamp({ value: 115, at: '2026-10-17T09:00:00.000Z', context: 'Jejum', mealId: 'refeição-inexistente' }); await db.glucose.add(invalid)
  const view = render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByText('Jejum')).toBeInTheDocument()
  expect(screen.queryByText(/Refeição associada/)).toBeNull()
  view.unmount()
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  const meal = stamp({ kind: 'Café da manhã', at: '2026-10-17T08:00:00.000Z' }); const glucose = stamp({ value: 115, at: '2026-10-17T09:00:00.000Z', context: 'Não informado', mealId: meal.id })
  await db.meals.add(meal); await db.glucose.add(glucose)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const glucoseDetail = await screen.findByRole('link', { name: /115 mg\/dL/ })
  await waitFor(() => expect(glucoseDetail).toHaveTextContent('Café da manhã'))
  expect(screen.queryByText(/Refeição associada/)).toBeNull()
  await db.glucose.put({ ...glucose, mealId: undefined, updatedAt: now() })
  await waitFor(() => expect(document.querySelector('.home-glucose-detail')).not.toHaveTextContent('Café da manhã'))
})

it('mostra as últimas aplicações basal e rápida, incluindo a mais recente posterior à glicemia', async () => {
  const glucose = stamp({ value: 115, at: '2026-10-17T12:00:00.000Z' })
  const basal = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: '2026-10-17T08:00:00.000Z', medicationName: 'Lantus' })
  const rapid = stamp({ kind: 'Rápida' as const, dose: 4.5, at: '2026-10-17T11:30:00.000Z', medicationName: 'NovoRapid' })
  const later = stamp({ kind: 'Basal/lenta' as const, dose: 20, at: '2026-10-17T13:00:00.000Z', medicationName: 'Tresiba' })
  await db.glucose.add(glucose); await db.insulin.bulkAdd([basal, rapid, later])
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const context = await screen.findByLabelText('Últimas aplicações registradas')
  expect(context).toHaveTextContent('Basal')
  expect(context).toHaveTextContent('Tresiba')
  expect(context).toHaveTextContent('20 UI')
  expect(context).toHaveTextContent('Aplicada após a última medição')
  expect(context).toHaveTextContent('Rápida')
  expect(context).toHaveTextContent('NovoRapid')
  expect(context).toHaveTextContent('4,5 UI')
  expect(screen.queryByRole('heading', { name: 'Últimas aplicações de insulina' })).toBeNull()
  expect(screen.getByRole('link', { name: /Basal.*Tresiba/i })).toHaveAttribute('href', `/detalhes/insulin/${later.id}`)
})

it('exibe somente a aplicação rápida mais recente e mantém o acesso ao cadastro sem aplicações', async () => {
  const glucose = stamp({ value: 115, at: '2026-10-17T12:00:00.000Z' })
  const rapid = stamp({ kind: 'Rápida' as const, dose: 3, at: '2026-10-17T12:00:00.000Z', medicationName: 'Humalog' })
  await db.glucose.add(glucose); await db.insulin.add(rapid)
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const context = await screen.findByLabelText('Últimas aplicações registradas')
  expect(context).toHaveTextContent('Rápida')
  expect(context).not.toHaveTextContent('Basal')
  await db.insulin.delete(rapid.id)
  await waitFor(() => expect(screen.getByLabelText('Últimas aplicações registradas')).toHaveTextContent('Nenhuma aplicação registrada.'))
  expect(screen.getAllByRole('link', { name: 'Registrar insulina' }).find(link => link.classList.contains('home-add-insulin'))).toHaveAttribute('href', '/insulina')
})

it('atualiza a última aplicação de cada categoria após alteração de horário', async () => {
  const glucose = stamp({ value: 115, at: '2026-10-17T12:00:00.000Z' })
  const basal = stamp({ kind: 'Basal/lenta' as const, dose: 18, at: '2026-10-17T08:00:00.000Z', medicationName: 'Lantus' })
  const rapid = stamp({ kind: 'Rápida' as const, dose: 3, at: '2026-10-17T10:00:00.000Z', medicationName: 'Humalog' })
  const updatedRapid = { ...rapid, at: '2026-10-17T13:00:00.000Z', medicationName: 'NovoRapid', updatedAt: now() }
  await db.glucose.add(glucose); await db.insulin.bulkAdd([basal, rapid])
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  const context = await screen.findByLabelText('Últimas aplicações registradas')
  expect(context).toHaveTextContent('Humalog')
  await db.insulin.put(updatedRapid)
  await waitFor(() => expect(context).toHaveTextContent('NovoRapid'))
  expect(context).toHaveTextContent('Aplicada após a última medição')
  const newerBasal = stamp({ kind: 'Basal/lenta' as const, dose: 20, at: '2026-10-17T14:00:00.000Z', medicationName: 'Tresiba' })
  await db.insulin.add(newerBasal)
  await waitFor(() => expect(context).toHaveTextContent('Tresiba'))
  expect(context.querySelectorAll('.glucose-insulin-context-line')[0]).toHaveTextContent('Tresiba')
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
