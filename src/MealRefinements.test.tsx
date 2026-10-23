import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'
import { exportBackup } from './database/backup'
import { deleteMeal, emptyMealItem } from './database/mealForm'
import { prepareMealReferencePreview } from './database/mealTimeReference'
import { MealItemsEditor } from './MealItemsEditor'

const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const open = (route = '/') => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const snapshot = async () => (await exportBackup()).data
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('ordena rótulos portugueses das unidades sem alterar códigos ou Selecionar', () => {
  render(<MealItemsEditor items={[emptyMealItem()]} onChange={() => {}} />)
  const options = within(screen.getByLabelText('Unidade')).getAllByRole('option') as HTMLOptionElement[]
  expect(options.map(option => option.textContent)).toEqual(['Selecionar', 'Colher de chá', 'Colher de sopa', 'Grama (g)', 'Litro (L)', 'Miligrama (mg)', 'Mililitro (mL)', 'Porção', 'Quilograma (kg)', 'Unidade', 'Xícara'])
  expect(options.map(option => option.value)).toEqual(['', 'tsp', 'tbsp', 'g', 'L', 'mg', 'mL', 'portion', 'kg', 'unit', 'cup'])
})

it('filtra exclusões antes do limite da Home e organiza tipo, horário e referência em linhas', async () => {
  await db.meals.bulkAdd([
    ...Array.from({ length: 4 }, (_, i) => stamp({ kind: `Excluída ${i}`, at: at(i), deletedAt: now() })),
    ...Array.from({ length: 3 }, (_, i) => stamp({ kind: `Ativa ${i}`, at: at(400 + i), timeReference: 'meal_start' as const })),
  ])
  open()
  await screen.findByRole('link', { name: /Ativa 0/ })
  const rows = document.querySelectorAll('.meal-list-item')
  expect(rows).toHaveLength(3)
  for (const row of rows) {
    expect(row.querySelector('.meal-record-info')?.children).toHaveLength(3)
    expect(row).toHaveTextContent('Início da refeição')
  }
  expect(screen.queryByText(/Excluída/)).toBeNull()
})

it('mantém paginação do histórico com muitas refeições excluídas', async () => {
  await db.meals.bulkAdd([
    ...Array.from({ length: 25 }, (_, i) => stamp({ kind: `Excluída ${i}`, at: at(i), deletedAt: now() })),
    ...Array.from({ length: 21 }, (_, i) => stamp({ kind: `Ativa ${i}`, at: at(50 + i), timeReference: 'meal_end' as const })),
  ])
  open('/historico?tipo=meals')
  await screen.findByRole('link', { name: /Ativa 0/ })
  expect(document.querySelectorAll('.history-link')).toHaveLength(20)
  expect(screen.queryByText(/Excluída/)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Carregar registros anteriores' }))
  await waitFor(() => expect(document.querySelectorAll('.history-link')).toHaveLength(21))
  expect(document.querySelectorAll('.meal-history-item .meal-record-info')).toHaveLength(21)
})

it('não conta refeições excluídas no relatório', async () => {
  await db.meals.bulkAdd([stamp({ kind: 'Ativa', at: at(5) }), stamp({ kind: 'Excluída', at: at(5), deletedAt: now() })])
  open('/relatorio')
  const card = (await screen.findByText('Refeições')).closest('section')!
  await waitFor(() => expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('1'))
})

it.each(['detalhes/meals', 'refeicao'])('não abre registro excluído pela rota %s', async path => {
  const meal = stamp({ kind: 'Excluída', at: at(5), deletedAt: now() }); await db.meals.add(meal)
  open(path === 'refeicao' ? `/${path}/${meal.id}/editar` : `/${path}/${meal.id}`)
  await screen.findByRole('heading', { name: 'Registro não encontrado' })
  expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull()
  expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull()
})

it('retira lembrete e refeição da Home imediatamente após exclusão lógica', async () => {
  const meal = stamp({ kind: 'Elegível', at: at(150), timeReference: 'meal_start' as const })
  await db.meals.add(meal)
  open()
  await screen.findByText('Que tal registrar sua glicemia?')
  await act(async () => { await deleteMeal(meal.id) })
  await waitFor(() => {
    expect(screen.queryByText('Que tal registrar sua glicemia?')).toBeNull()
    expect(screen.queryByRole('link', { name: /Elegível/ })).toBeNull()
  })
})

it('modal permite cancelar e depois excluir refeição com itens sem tocar no catálogo', async () => {
  const food = stamp({ name: 'Arroz', revision: 1 }), meal = stamp({ kind: 'Almoço', at: at(5) })
  const item = stamp({ mealId: meal.id, foodId: food.id, foodName: 'Arroz consumido', quantity: '1.250000', unit: 'cup' as const, revision: 1 })
  await db.foods.add(food); await db.meals.add(meal); await db.mealItems.add(item)
  open(`/detalhes/meals/${meal.id}`)
  const trigger = await screen.findByRole('button', { name: 'Excluir' })
  await userEvent.click(trigger)
  const dialog = await screen.findByRole('alertdialog', { name: 'Excluir este registro?' })
  expect(dialog.tagName).toBe('DIALOG'); expect(dialog.parentElement).toBe(document.body)
  expect(dialog.closest('.details-actions')).toBeNull()
  const cancel = within(dialog).getByRole('button', { name: 'Cancelar' })
  expect(cancel).toHaveFocus()
  await userEvent.click(cancel)
  expect(await db.meals.get(meal.id)).toEqual(meal)
  expect(await db.mealItems.get(item.id)).toEqual(item)
  await userEvent.click(trigger)
  await userEvent.click(await screen.findByRole('button', { name: 'Confirmar exclusão' }))
  await screen.findByRole('heading', { name: 'Histórico' })
  expect((await db.meals.get(meal.id))?.deletedAt).toBeTruthy()
  expect(await db.mealItems.get(item.id)).toMatchObject({ id: item.id, foodId: food.id, foodName: item.foodName, quantity: item.quantity, revision: 2 })
  expect((await db.mealItems.get(item.id))?.deletedAt).toBeTruthy()
  expect(await db.foods.get(food.id)).toEqual(food)
  expect(document.querySelector('.history-link')).toBeNull()
})

it('bloqueia na confirmação um vínculo clínico surgido depois da prévia', async () => {
  const meal = stamp({ kind: 'Almoço', at: at(5) }); await db.meals.add(meal)
  open(`/detalhes/meals/${meal.id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  const confirm = await screen.findByRole('button', { name: 'Confirmar exclusão' })
  await act(async () => { await db.insulin.add(stamp({ at: at(2), kind: 'Rápida' as const, dose: 1, mealId: meal.id })) })
  const before = await snapshot()
  await userEvent.click(confirm)
  expect(await screen.findByRole('alert')).toHaveTextContent('registros de insulina')
  expect(screen.getByRole('alertdialog')).toContainElement(screen.getByRole('alert'))
  expect(await snapshot()).toEqual(before)
})

it('prévia de classificação mantém backup completo sem selecionar refeições excluídas', async () => {
  const active = stamp({ kind: 'Antiga', at: at(5) }), deleted = stamp({ kind: 'Excluída', at: at(5) })
  await db.meals.bulkAdd([active, deleted]); await deleteMeal(deleted.id)
  const before = await snapshot(), preview = await prepareMealReferencePreview()
  expect(preview.meals.map(meal => meal.id)).toEqual([active.id])
  expect(preview.backup.data).toEqual(before)
  expect(await snapshot()).toEqual(before)
})

it.each(['glicemia', 'insulina'] as const)('não cria vínculo de %s com refeição excluída após preencher o formulário', async kind => {
  const meal = stamp({ kind: 'Almoço', at: at(5) }); await db.meals.add(meal)
  open(`/${kind}`)
  if (kind === 'glicemia') {
    fireEvent.change(screen.getByLabelText('Valor (mg/dL)'), { target: { value: '123' } })
    fireEvent.change(screen.getByLabelText('Contexto'), { target: { value: 'Após refeição' } })
  } else {
    fireEvent.change(screen.getByLabelText('Dose (UI)'), { target: { value: '1' } })
    await userEvent.click(screen.getByLabelText('Confirmo que esta dose corresponde à quantidade efetivamente aplicada.'))
  }
  const select = await screen.findByLabelText('Associar a uma refeição (opcional)')
  await waitFor(() => expect(within(select).getByRole('option', { name: /Almoço/ })).toBeInTheDocument())
  fireEvent.change(select, { target: { value: meal.id } })
  const form = screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!
  await act(async () => { await deleteMeal(meal.id); fireEvent.submit(form) })
  expect(await screen.findByRole('alert')).toHaveTextContent('A refeição selecionada não está mais disponível')
  expect(await db.glucose.count()).toBe(0); expect(await db.insulin.count()).toBe(0)
  expect((await db.meals.get(meal.id))?.deletedAt).toBeTruthy()
})
