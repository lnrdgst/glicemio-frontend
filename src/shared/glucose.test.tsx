import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'
import { db, now, stamp } from '../database/db'
import { classifyGlucose, hypoglycemiaGuidance } from './glucose'

it.each([
  [53, 'hypoglycemia-level-2'], [54, 'hypoglycemia-level-1'], [69, 'hypoglycemia-level-1'], [70, 'below-range'], [79, 'below-range'], [80, 'in-range'], [130, 'in-range'], [131, 'intermediate'], [170, 'intermediate'], [171, 'attention'], [299, 'attention'], [300, 'high-attention'], [301, 'high-attention'],
])('classifica %s mg/dL como %s', (value, id) => expect(classifyGlucose(value)).toMatchObject({ id }))

it('trata valores inválidos e não atribui hipoglicemia clínica nível 3', () => {
  expect(classifyGlucose(Number.NaN)).toMatchObject({ id: 'invalid' })
  expect(classifyGlucose(-1)).toMatchObject({ id: 'invalid' })
  expect(hypoglycemiaGuidance(classifyGlucose(70))).toBeUndefined()
  expect(hypoglycemiaGuidance(classifyGlucose(53))).toMatch(/Atenção alta/)
})

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
})
afterEach(cleanup)

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
  expect(history.closest('.home-section')!.querySelector('.glucose-card')).toBeTruthy()
})
