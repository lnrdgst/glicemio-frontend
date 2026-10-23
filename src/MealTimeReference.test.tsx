import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { MealTimeReferenceReview } from './MealTimeReferenceReview'
import { db, stamp, type MealTimeReference } from './database/db'
import { exportBackup, previewBackup, restoreBackup } from './database/backup'
import { classifyMealReferences, prepareMealReferencePreview } from './database/mealTimeReference'
import { mealTimeReferenceLabel } from './shared/meals'
import { localInput } from './shared/format'

const at = '2026-10-14T12:34:56.789-03:00'
const makeMeal = (timeReference?: MealTimeReference) => stamp({ kind: 'Almoço', at, description: 'Registro original', ...(timeReference ? { timeReference } : {}) })
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Pessoa de teste', createdAt: at, updatedAt: at })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('classificação explícita com backup', () => {
  it('altera somente a referência selecionada e preserva integralmente todas as nove tabelas', async () => {
    const own = makeMeal(), another = makeMeal(), start = makeMeal('meal_start'), end = makeMeal('meal_end'), unknown = makeMeal('unconfirmed')
    await db.meals.bulkAdd([own, another, start, end, unknown])
    const episode = stamp({ startedAt: at, symptoms: ['Suor'] }); await db.episodes.add(episode)
    await db.glucose.add(stamp({ value: 100, at, mealId: own.id, episodeId: episode.id }))
    await db.insulin.add(stamp({ kind: 'Rápida' as const, dose: 2, at, mealId: own.id }))
    await db.workouts.add(stamp({ activity: 'Caminhada', startedAt: at }))
    await db.appointments.add(stamp({ at, professional: 'Teste' }))
    const food = stamp({ name: 'Alimento sintético', revision: 1 }); await db.foods.add(food)
    await db.mealItems.add(stamp({ mealId: own.id, foodId: food.id, foodName: 'Nome histórico preservado', quantity: '1.234567', unit: 'cup' as const, revision: 1 }))
    const preview = await prepareMealReferencePreview()
    expect(preview.meals.map(meal => meal.id).sort()).toEqual([own.id, another.id, unknown.id].sort())
    expect((await exportBackup()).data).toEqual(preview.backup.data)
    const saved = JSON.stringify(preview.backup)
    expect(await classifyMealReferences(preview, [own.id, unknown.id], saved, true)).toBe(2)
    expect((await exportBackup()).data).toEqual({ ...preview.backup.data, meals: preview.backup.data.meals.map(meal => [own.id, unknown.id].includes(meal.id) ? { ...meal, timeReference: 'meal_end' } : meal) })
    expect(await db.meals.get(own.id)).toEqual({ ...own, timeReference: 'meal_end' })
    expect(await db.meals.get(another.id)).toEqual(another)
    expect(db.verno).toBe(3)
  })

  it('exige confirmação e arquivo de backup correspondente sem nenhuma escrita', async () => {
    const meal = makeMeal(); await db.meals.add(meal)
    const preview = await prepareMealReferencePreview(), saved = JSON.stringify(preview.backup)
    await expect(classifyMealReferences(preview, [meal.id], saved, false)).rejects.toThrow(/Confirme/)
    await expect(classifyMealReferences(preview, [meal.id], '', true)).rejects.toThrow(/JSON/)
    const changed = structuredClone(preview.backup); changed.data.meals[0].at = '2026-01-01T00:00:00Z'
    await expect(classifyMealReferences(preview, [meal.id], JSON.stringify(changed), true)).rejects.toThrow(/não corresponde/)
    expect(await db.meals.get(meal.id)).toEqual(meal)
  })

  it('bloqueia prévia desatualizada mesmo se a mudança ocorreu em outra tabela', async () => {
    const meal = makeMeal(); await db.meals.add(meal)
    const preview = await prepareMealReferencePreview()
    await db.profiles.update('local', { name: 'Outra pessoa' })
    await expect(classifyMealReferences(preview, [meal.id], JSON.stringify(preview.backup), true)).rejects.toThrow(/dados mudaram/)
    expect(await db.meals.get(meal.id)).toEqual(meal)
  })

  it.each(['foods', 'mealItems'] as const)('bloqueia alteração em %s após a prévia e exige backup completo das novas coleções', async table => {
    const meal = makeMeal(), food = stamp({ name: 'Alimento', revision: 1 })
    const item = stamp({ mealId: meal.id, foodId: food.id, foodName: 'Nome histórico', quantity: '0.5', unit: 'unit' as const, revision: 1 })
    await db.meals.add(meal); await db.foods.add(food); await db.mealItems.add(item)
    const preview = await prepareMealReferencePreview()
    const incomplete = structuredClone(preview.backup); incomplete.data.mealItems = []
    await expect(classifyMealReferences(preview, [meal.id], JSON.stringify(incomplete), true)).rejects.toThrow(/não corresponde/)
    if (table === 'foods') await db.foods.update(food.id, { name: 'Nome alterado' })
    else await db.mealItems.update(item.id, { quantity: '2' })
    const before = (await exportBackup()).data
    await expect(classifyMealReferences(preview, [meal.id], JSON.stringify(preview.backup), true)).rejects.toThrow(/dados mudaram/)
    expect((await exportBackup()).data).toEqual(before)
  })

  it('bloqueia referências ausentes antes de oferecer a classificação', async () => {
    await db.meals.add(makeMeal()); await db.glucose.add(stamp({ value: 100, at, mealId: 'ausente' }))
    await expect(prepareMealReferencePreview()).rejects.toThrow(/referências ausentes/)
    expect((await db.meals.toArray())[0].timeReference).toBeUndefined()
  })

  it('não aceita converter uma referência já confirmada nem IDs duplicados', async () => {
    const meal = makeMeal(), start = makeMeal('meal_start'); await db.meals.bulkAdd([meal, start])
    const preview = await prepareMealReferencePreview(), saved = JSON.stringify(preview.backup)
    for (const ids of [[], [start.id], [meal.id, meal.id], ['ausente']]) await expect(classifyMealReferences(preview, ids, saved, true)).rejects.toThrow(/Selecione/)
    expect(await db.meals.get(start.id)).toEqual(start)
  })

  it('faz rollback de todas as classificações se uma escrita falhar', async () => {
    const first = makeMeal(), second = makeMeal(); await db.meals.bulkAdd([first, second])
    const preview = await prepareMealReferencePreview()
    const update = db.meals.update.bind(db.meals)
    vi.spyOn(db.meals, 'update').mockImplementationOnce((...args) => update(...args)).mockRejectedValueOnce(new Error('Falha simulada'))
    await expect(classifyMealReferences(preview, [first.id, second.id], JSON.stringify(preview.backup), true)).rejects.toThrow('Falha simulada')
    expect((await exportBackup()).data).toEqual(preview.backup.data)
  })

  it('faz rollback se a verificação final detectar alteração além do metadado', async () => {
    const meal = makeMeal(); await db.meals.add(meal)
    const preview = await prepareMealReferencePreview(), update = db.meals.update.bind(db.meals)
    vi.spyOn(db.meals, 'update').mockImplementationOnce((id, changes) => update(id, { ...changes, at: '2026-01-01T00:00:00Z' }))
    await expect(classifyMealReferences(preview, [meal.id], JSON.stringify(preview.backup), true)).rejects.toThrow(/integridade falhou/)
    expect(await db.meals.get(meal.id)).toEqual(meal)
  })
})

describe('referência temporal nos formulários e backups', () => {
  it.each([
    [undefined, 'Referência não confirmada', 'Hora da refeição (referência não confirmada)'],
    ['unconfirmed', 'Referência não confirmada', 'Hora da refeição (referência não confirmada)'],
    ['meal_start', 'Início da refeição', 'Hora do início da refeição'],
    ['meal_end', 'Fim da refeição', 'Hora do fim da refeição'],
  ] as const)('apresenta %s na edição sem alterar referência ou instante original ao salvar descrição', async (reference, label, timeLabel) => {
    const meal = makeMeal(reference); await db.meals.add(meal)
    render(<MemoryRouter initialEntries={[`/refeicao/${meal.id}/editar`]}><App /></MemoryRouter>)
    expect(await screen.findByText(label)).toBeInTheDocument()
    const time = screen.getByLabelText(timeLabel)
    expect(time).toHaveAttribute('type', 'time')
    expect(time).toBeRequired()
    expect(time).toHaveValue(localInput(meal.at).slice(11))
    expect(screen.queryByLabelText('Hora')).toBeNull()
    fireEvent.change(await screen.findByLabelText('Descrição (opcional)'), { target: { value: 'Descrição corrigida' } })
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações da refeição' }))
    await screen.findByRole('heading', { name: 'Olá, Pessoa de teste' })
    const saved = await db.meals.get(meal.id)
    expect(saved).toMatchObject({ id: meal.id, at: meal.at, createdAt: meal.createdAt, description: 'Descrição corrigida' })
    expect(saved?.timeReference).toBe(reference)
    if (!reference) expect(saved).not.toHaveProperty('timeReference')
    expect(screen.queryByText(/tempo após o início/i)).toBeNull()
  })

  it('salva toda nova refeição como início sem classificar os registros anteriores', async () => {
    const legacy = makeMeal(); await db.meals.add(legacy)
    render(<MemoryRouter initialEntries={['/refeicao']}><App /></MemoryRouter>)
    expect(await screen.findByText('Início da refeição')).toBeInTheDocument()
    expect(screen.getByLabelText('Hora do início da refeição')).toHaveAttribute('type', 'time')
    fireEvent.change(screen.getByLabelText('Tipo de refeição'), { target: { value: 'Lanche' } })
    await userEvent.click(screen.getByRole('button', { name: 'Salvar registro de refeição' }))
    await screen.findByRole('heading', { name: 'Olá, Pessoa de teste' })
    expect((await db.meals.toArray()).find(meal => meal.id !== legacy.id)?.timeReference).toBe('meal_start')
    expect(await db.meals.get(legacy.id)).toEqual(legacy)
  })

  it('exporta e restaura as três referências, mantendo compatibilidade com refeições sem metadado', async () => {
    await db.meals.bulkAdd([makeMeal(), makeMeal('unconfirmed'), makeMeal('meal_start'), makeMeal('meal_end')])
    const backup = await exportBackup(); await db.meals.clear()
    await restoreBackup(await previewBackup(JSON.stringify(backup)), 'keep')
    expect((await exportBackup()).data.meals).toEqual(backup.data.meals)
    await db.meals.clear()
    const legacy = structuredClone(backup.data); legacy.meals = [makeMeal()]
    await restoreBackup(await previewBackup(JSON.stringify(legacy)), 'keep')
    expect((await db.meals.toArray())[0]).not.toHaveProperty('timeReference')
    expect(mealTimeReferenceLabel((await db.meals.toArray())[0])).toBe('Referência não confirmada')
  })

  it.each(['start', null, 1])('rejeita metadado temporal inválido %s na importação', async invalid => {
    const backup = await exportBackup(); backup.data.meals.push({ ...makeMeal(), timeReference: invalid as MealTimeReference })
    await expect(previewBackup(JSON.stringify(backup))).rejects.toThrow(/inválidos/)
    expect(await db.meals.count()).toBe(0)
  })
})

describe('prévia e confirmação na interface', () => {
  const mockDownload = () => {
    const create = vi.fn(() => 'blob:backup')
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return create
  }
  it('exige seleção, conferência do arquivo salvo e confirmação antes de alterar apenas a refeição escolhida', async () => {
    const first = makeMeal(), other = { ...makeMeal(), kind: 'Jantar' }; await db.meals.bulkAdd([first, other])
    const download = mockDownload(); render(<MealTimeReferenceReview />)
    await userEvent.click(screen.getByRole('button', { name: 'Preparar prévia e baixar backup' }))
    const confirm = await screen.findByRole('button', { name: 'Confirmar classificação como fim' })
    expect(confirm).toBeDisabled(); expect(await db.meals.get(first.id)).toEqual(first)
    expect(download).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('checkbox', { name: /Almoço/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Confirmo que as refeições/ }))
    expect(confirm).toBeDisabled()
    // O mesmo conteúdo do snapshot deve ter sido salvo; nenhuma confirmação por checkbox substitui o arquivo.
    const backup = await exportBackup()
    fireEvent.change(screen.getByLabelText('Conferir o backup JSON que acabou de salvar'), { target: { files: [{ text: async () => JSON.stringify(backup) }] } })
    await screen.findByText(/Backup conferido/)
    expect(confirm).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /Confirmo que as refeições/ }))
    await userEvent.click(confirm)
    await screen.findByText(/1 refeição\(ões\) classificada/)
    expect(await db.meals.get(first.id)).toEqual({ ...first, timeReference: 'meal_end' })
    expect(await db.meals.get(other.id)).toEqual(other)
  })

  it('cancelar a prévia não modifica registros e um arquivo incorreto não libera a confirmação', async () => {
    const meal = makeMeal(); await db.meals.add(meal); mockDownload(); render(<MealTimeReferenceReview />)
    await userEvent.click(screen.getByRole('button', { name: 'Preparar prévia e baixar backup' }))
    const input = await screen.findByLabelText('Conferir o backup JSON que acabou de salvar')
    fireEvent.change(input, { target: { files: [{ text: async () => '{}' }] } })
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Confirmar classificação como fim' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar classificação' }))
    expect(await db.meals.get(meal.id)).toEqual(meal)
    expect(screen.queryByText(/Backup conferido/)).toBeNull()
  })

  it('não faz download nem oferece confirmação quando não há refeições elegíveis', async () => {
    await db.meals.add(makeMeal('meal_start')); const download = mockDownload(); render(<MealTimeReferenceReview />)
    await userEvent.click(screen.getByRole('button', { name: 'Preparar prévia e baixar backup' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Não há refeições'))
    expect(download).not.toHaveBeenCalled()
  })
})
