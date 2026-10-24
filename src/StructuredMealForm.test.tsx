import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp, type MealTimeReference } from './database/db'
import { exportBackup, previewBackup, restoreBackup } from './database/backup'
import { nextMealUpdate } from './database/mealForm'

const historicalAt = '2026-10-14T12:34:56.123456-03:00'
const open = (route = '/refeicao') => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const change = (label: string, value: string, scope = screen) => fireEvent.change(scope.getByLabelText(label), { target: { value } })
const save = () => userEvent.click(screen.getByRole('button', { name: /Salvar (registro de refeição|alterações da refeição)/ }))
const saved = () => screen.findByRole('heading', { name: 'Olá, Teste' })
const add = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Adicionar alimento' }))
  return screen.getAllByRole('group', { name: /^Alimento \d+$/ }).at(-1)!
}
const fill = (group: HTMLElement, name: string, quantity: string, unit = 'g') => {
  const row = within(group)
  fireEvent.change(row.getByLabelText('Nome do alimento'), { target: { value: name } })
  fireEvent.change(row.getByLabelText('Quantidade'), { target: { value: quantity } })
  fireEvent.change(row.getByLabelText('Unidade'), { target: { value: unit } })
}
const snapshot = async () => (await exportBackup()).data
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('cadastra vários alimentos com decimais exatos e mostra nomes e unidades nos detalhes', async () => {
  open(); change('Tipo de refeição', 'Almoço')
  const first = await add(); fill(first, 'Arroz', '0,5', 'cup')
  const second = await add(); fill(second, 'Feijão', '999999999999.999999')
  change('Descrição (opcional)', 'Descrição livre preservada')
  await save(); await saved()
  const meal = (await db.meals.toArray())[0], items = await db.mealItems.toArray()
  expect(meal).toMatchObject({ kind: 'Almoço', timeReference: 'meal_start', description: 'Descrição livre preservada' })
  expect(items.find(item => item.foodName === 'Arroz')).toMatchObject({ mealId: meal.id, quantity: '0.5', unit: 'cup' })
  expect(items.find(item => item.foodName === 'Feijão')?.quantity).toBe('999999999999.999999')
  expect(items.every(item => typeof item.foodId === 'string')).toBe(true)
  expect(await db.foods.count()).toBe(2)
  await userEvent.click(screen.getByRole('link', { name: /Almoço.*Hoje/ }))
  const summary = await screen.findByRole('region', { name: 'Alimentos consumidos' })
  expect(within(summary).getByText('Arroz')).toBeInTheDocument()
  expect(within(summary).getByText('0,5 · Xícara')).toBeInTheDocument()
})

it('sugere sem distinguir caixa ou acentos, permite teclado e não preenche quantidade', async () => {
  const selected = stamp({ name: 'Maçã Fuji', revision: 1 })
  await db.foods.bulkAdd([selected, stamp({ name: 'Maçã verde', revision: 1 }), stamp({ name: 'Maçã excluída', revision: 2, deletedAt: now() })])
  open(); change('Tipo de refeição', 'Lanche')
  const group = await add(), row = within(group), input = row.getByRole('combobox', { name: 'Nome do alimento' })
  await userEvent.type(input, 'MACA')
  await row.findByRole('option', { name: 'Maçã Fuji' })
  expect(row.queryByRole('option', { name: 'Maçã excluída' })).toBeNull()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(input).toHaveValue('Maçã Fuji')
  expect(row.getByLabelText('Quantidade')).toHaveValue('')
  expect(row.getByLabelText('Unidade')).toHaveValue('')
  fireEvent.change(row.getByLabelText('Quantidade'), { target: { value: '1.25' } })
  fireEvent.change(row.getByLabelText('Unidade'), { target: { value: 'unit' } })
  await save(); await saved()
  expect((await db.mealItems.toArray())[0]).toMatchObject({ foodId: selected.id, foodName: 'Maçã Fuji', quantity: '1.25', unit: 'unit' })
  expect(await db.foods.count()).toBe(3)
})

it('reutiliza correspondência exata única automaticamente, sem gravar catálogo antes de salvar', async () => {
  const existing = stamp({ name: 'Arroz', revision: 1 }); await db.foods.add(existing)
  open(); change('Tipo de refeição', 'Almoço')
  const group = await add(); fill(group, 'arroz', '2', 'portion')
  expect(await db.foods.count()).toBe(1)
  expect(within(group).getByText(/Ao salvar/)).toBeInTheDocument()
  await save(); await saved()
  const foods = await db.foods.toArray(), item = (await db.mealItems.toArray())[0]
  expect(foods).toHaveLength(1)
  expect(item.foodId).toBe(existing.id)
  expect(foods.find(food => food.id === item.foodId)?.name).toBe('Arroz')
})

it('remove rascunho antes de salvar sem criar alimento órfão e aceita somente descrição', async () => {
  open(); change('Tipo de refeição', 'Jantar')
  const group = await add(); fill(group, 'Novo alimento', '2', 'tbsp')
  await userEvent.click(screen.getByRole('button', { name: 'Remover alimento 1' }))
  change('Descrição (opcional)', 'Somente descrição')
  await save(); await saved()
  expect((await db.meals.toArray())[0]?.description).toBe('Somente descrição')
  expect(await db.mealItems.count()).toBe(0); expect(await db.foods.count()).toBe(0)
})

it.each(['meal_start', 'meal_end', 'unconfirmed', undefined] as const)('adiciona itens a refeição antiga %s sem mudar at ou referência', async timeReference => {
  const meal = stamp({ kind: 'Almoço', at: historicalAt, timeReference, description: '  Descrição histórica  ' })
  await db.meals.add(meal); open(`/refeicao/${meal.id}/editar`)
  await screen.findByRole('heading', { name: 'Editar refeição' })
  expect(screen.queryAllByRole('group', { name: /^Alimento \d+$/ })).toHaveLength(0)
  const group = await add(); fill(group, 'Alimento consumido', '1.234567', 'g')
  await save(); await saved()
  expect(await db.meals.get(meal.id)).toMatchObject({ id: meal.id, at: historicalAt, createdAt: meal.createdAt, description: meal.description })
  expect((await db.meals.get(meal.id))?.timeReference).toBe(timeReference)
  expect((await db.mealItems.toArray())[0]?.mealId).toBe(meal.id)
})

it('editar quantidade preserva UUID, alimento e nome histórico apesar de renomeação do catálogo', async () => {
  const food = stamp({ name: 'Nome atual no catálogo', revision: 2 }), meal = stamp({ kind: 'Jantar', at: historicalAt, timeReference: 'meal_end' as const })
  const item = stamp({ mealId: meal.id, foodId: food.id, foodName: 'Nome histórico consumido', quantity: '1.2', unit: 'cup' as const, revision: 1 })
  await db.foods.add(food); await db.meals.add(meal); await db.mealItems.add(item)
  open(`/refeicao/${meal.id}/editar`)
  const input = await screen.findByLabelText('Quantidade')
  expect(screen.getByLabelText('Nome do alimento')).toHaveValue('Nome histórico consumido')
  fireEvent.change(input, { target: { value: '2,75' } })
  await save(); await saved()
  expect(await db.mealItems.get(item.id)).toMatchObject({ id: item.id, foodId: food.id, foodName: item.foodName, quantity: '2.75', createdAt: item.createdAt, revision: 2 })
  expect(await db.foods.get(food.id)).toEqual(food)
  expect((await db.meals.get(meal.id))?.at).toBe(historicalAt)
})

it('remover item salvo mantém histórico no banco e no backup, sem apagar o alimento', async () => {
  const food = stamp({ name: 'Arroz', revision: 1 }), meal = stamp({ kind: 'Almoço', at: historicalAt })
  const item = stamp({ mealId: meal.id, foodId: food.id, foodName: 'Arroz histórico', quantity: '1', unit: 'portion' as const, revision: 1 })
  await db.foods.add(food); await db.meals.add(meal); await db.mealItems.add(item)
  const view = open(`/refeicao/${meal.id}/editar`)
  await userEvent.click(await screen.findByRole('button', { name: 'Remover alimento 1' }))
  expect(await db.mealItems.get(item.id)).toEqual(item)
  await save(); await saved()
  const removed = await db.mealItems.get(item.id)
  expect(removed).toMatchObject({ id: item.id, foodId: food.id, quantity: '1', foodName: item.foodName, revision: 2, createdAt: item.createdAt })
  expect(removed?.deletedAt).toBeTruthy()
  expect((await exportBackup()).data.mealItems[0]).toEqual(removed)
  expect(await db.foods.get(food.id)).toEqual(food)
  view.unmount(); open(`/refeicao/${meal.id}/editar`)
  await screen.findByRole('heading', { name: 'Editar refeição' })
  expect(screen.queryByLabelText('Quantidade')).toBeNull()
})

it('faz rollback de catálogo, refeição e itens, mantém rascunho e permite tentar novamente', async () => {
  open(); change('Tipo de refeição', 'Almoço')
  const group = await add(); fill(group, 'Alimento novo', '0,5', 'cup')
  const before = await snapshot()
  vi.spyOn(db.mealItems, 'bulkPut').mockRejectedValueOnce(new Error('Falha sintética'))
  await save()
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar')
  expect(await snapshot()).toEqual(before)
  expect(screen.getByLabelText('Nome do alimento')).toHaveValue('Alimento novo')
  expect(screen.getByLabelText('Quantidade')).toHaveValue('0,5')
  await save(); await saved()
  expect(await db.foods.count()).toBe(1); expect(await db.mealItems.count()).toBe(1); expect(await db.meals.count()).toBe(1)
})

it('detecta edição concorrente sem sobrescrever registro ou rascunho', async () => {
  const meal = stamp({ kind: 'Almoço', at: historicalAt }), item = stamp({ mealId: '', foodName: 'Arroz', quantity: '1', unit: 'g' as const, revision: 1 })
  item.mealId = meal.id
  await db.meals.add(meal); await db.mealItems.add(item)
  open(`/refeicao/${meal.id}/editar`)
  fireEvent.change(await screen.findByLabelText('Quantidade'), { target: { value: '2' } })
  await act(async () => { await db.mealItems.update(item.id, { quantity: '3', revision: 2, updatedAt: nextMealUpdate(item.updatedAt) }) })
  const before = await snapshot()
  await save()
  expect(await screen.findByRole('alert')).toHaveTextContent('Reabra o registro')
  expect(await snapshot()).toEqual(before)
  expect(screen.getByLabelText('Quantidade')).toHaveValue('2')
})

it('editar somente a descrição não regrava itens nem acompanha renomeação do catálogo', async () => {
  const meal = stamp({ kind: 'Almoço', at: historicalAt }), food = stamp({ name: 'Nome novo do catálogo', revision: 2 })
  const item = stamp({ mealId: meal.id, foodId: food.id, foodName: 'Nome histórico', quantity: '1.000000', unit: 'unit' as const, revision: 1 })
  await db.meals.add(meal); await db.foods.add(food); await db.mealItems.add(item)
  open(`/refeicao/${meal.id}/editar`)
  await screen.findByLabelText('Quantidade')
  change('Descrição (opcional)', 'Descrição corrigida')
  await save(); await saved()
  expect(await db.mealItems.get(item.id)).toEqual(item)
  expect(await db.foods.get(food.id)).toEqual(food)
})

it('rollback de edição desfaz até escritas já realizadas de catálogo, refeição e exclusões lógicas', async () => {
  const meal = stamp({ kind: 'Almoço', at: historicalAt }), item = stamp({ mealId: '', foodName: 'Original', quantity: '1', unit: 'unit' as const, revision: 1 })
  item.mealId = meal.id
  await db.meals.add(meal); await db.mealItems.add(item)
  open(`/refeicao/${meal.id}/editar`)
  await userEvent.click(await screen.findByRole('button', { name: 'Remover alimento 1' }))
  const group = await add(); fill(group, 'Novo', '2', 'portion')
  change('Descrição (opcional)', 'Não deve persistir após falha')
  const before = await snapshot(), write = db.mealItems.bulkPut.bind(db.mealItems)
  vi.spyOn(db.mealItems, 'bulkPut').mockImplementationOnce(records => write(records).then(() => { throw new Error('Falha após escrever itens') }))
  await save()
  await screen.findByRole('alert')
  expect(await snapshot()).toEqual(before)
})

it('preserva refeição legada sem itens, ID opaco e horário incompleto ao corrigir descrição', async () => {
  const meal = { ...stamp({ kind: 'Almoço', at: '2026-10-14', description: 'Texto antigo' }), id: 'identificador-legado' }
  await db.meals.add(meal); open(`/refeicao/${meal.id}/editar`)
  fireEvent.change(await screen.findByLabelText('Descrição (opcional)'), { target: { value: 'Texto corrigido' } })
  await save(); await saved()
  expect(await db.meals.get(meal.id)).toMatchObject({ id: meal.id, at: meal.at, createdAt: meal.createdAt, description: 'Texto corrigido' })
  expect(await db.meals.get(meal.id)).not.toHaveProperty('timeReference')
  expect(await db.foods.count()).toBe(0); expect(await db.mealItems.count()).toBe(0)
})

it('salva offline sem API e exporta/restaura o formulário completo com backup v2', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline sintético'))
  const view = open(); change('Tipo de refeição', 'Almoço')
  const group = await add(); fill(group, 'Feijão', '1.25', 'tbsp')
  await save(); await saved()
  expect(request).not.toHaveBeenCalled()
  const backup = await exportBackup(), meal = backup.data.meals[0]
  expect(backup.version).toBe(2); expect(backup.data.mealItems[0]).not.toHaveProperty('createFood')
  view.unmount(); await Promise.all(db.tables.map(table => table.clear()))
  await restoreBackup(await previewBackup(JSON.stringify(backup)), 'restore')
  expect(await snapshot()).toEqual(backup.data)
  open(`/refeicao/${meal.id}/editar`)
  expect(await screen.findByLabelText('Nome do alimento')).toHaveValue('Feijão')
  expect(screen.getByLabelText('Quantidade')).toHaveValue('1.25')
  expect(screen.getByLabelText('Unidade')).toHaveValue('tbsp')
})

it.each(['0', '-1', '0.0000001', '1e3', '1000000000000'])('rejeita quantidade %s sem arredondamento nem escrita', async quantity => {
  open(); change('Tipo de refeição', 'Almoço')
  const group = await add(); fill(group, 'Arroz', quantity)
  const before = await snapshot()
  await save()
  expect(await screen.findByRole('alert')).toHaveTextContent('Nenhum valor será arredondado')
  expect(await snapshot()).toEqual(before)
  expect(screen.getByLabelText('Quantidade')).toHaveValue(quantity)
})

it('pede confirmação ao sair com alimento novo pendente e cancelar não grava catálogo', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  open(); const group = await add(); fill(group, 'Alimento pendente', '1', 'unit')
  await userEvent.click(screen.getByRole('link', { name: 'Histórico' }))
  expect(confirm).toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'Registrar refeição' })).toBeInTheDocument()
  confirm.mockReturnValue(true)
  await userEvent.click(screen.getByRole('link', { name: 'Histórico' }))
  await screen.findByRole('heading', { name: 'Histórico' })
  expect(await db.foods.count()).toBe(0); expect(await db.meals.count()).toBe(0)
})

it.each(['insulina', 'múltiplos'] as const)('informa o bloqueio por %s nos detalhes e preserva todos os registros', async dependency => {
  const meal = stamp({ kind: 'Almoço', at: historicalAt })
  await db.meals.add(meal)
  if (dependency !== 'insulina') await db.mealItems.add(stamp({ mealId: meal.id, foodName: 'Arroz', quantity: '1', unit: 'g' as const, revision: 1 }))
  await db.insulin.add(stamp({ at: historicalAt, kind: 'Rápida' as const, dose: 1, mealId: meal.id }))
  if (dependency === 'múltiplos') await db.glucose.add(stamp({ at: historicalAt, value: 123, mealId: meal.id }))
  const before = await snapshot()
  open(`/detalhes/meals/${meal.id}`)
  await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
  const alert = await screen.findByRole('alert')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  if (dependency === 'insulina') expect(alert).toHaveTextContent('Esta refeição está associada a registros de insulina e não pode ser excluída.')
  else {
    expect(alert).toHaveTextContent('medições de glicemia e registros de insulina')
    expect(alert).toHaveTextContent('medições de glicemia')
    expect(alert).toHaveTextContent('registros de insulina')
  }
  expect(screen.getByRole('heading', { name: 'Refeição' })).toBeInTheDocument()
  expect(screen.queryByText('Registro excluído deste dispositivo.')).toBeNull()
  expect(await snapshot()).toEqual(before)
})
