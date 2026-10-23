import { describe, expect, it } from 'vitest'
import type { Meal } from '../database/db'
import { nextPostMealCheck, postMealDismissalValue, postMealWindow, reminderInstant, selectPostMealReminder } from './postMealReminder'

const start = Date.parse('2026-10-23T12:00:00Z'), minute = 60_000
const meal: Meal = { id: 'meal', kind: 'Almoço', at: new Date(start).toISOString(), timeReference: 'meal_start', createdAt: '2000-01-01T00:00:00Z', updatedAt: '2000-01-01T00:00:00Z' }
const select = (elapsed: number, glucose: { at: string }[] = [], meals = [meal]) => selectPostMealReminder({ meals, glucose, now: start + elapsed, enabled: true })
describe('política de UX do lembrete pós-refeição', () => {
  it('ignora refeições excluídas na seleção e no agendamento, inclusive após reabertura', () => {
    const deleted = { ...meal, deletedAt: new Date(start).toISOString() }
    expect(select(150 * minute, [], [JSON.parse(JSON.stringify(deleted))])).toBeUndefined()
    expect(nextPostMealCheck([deleted], start + postMealWindow.showFrom - 1)).toBe(30_000)
    expect(select(150 * minute, [], [deleted, { ...meal, id: 'ativa' }])?.id).toBe('ativa')
  })
  it.each([[0, false], [120 * minute - 1, false], [120 * minute, true], [150 * minute, true], [180 * minute - 1, true], [180 * minute, false], [240 * minute, false]] as const)('em %s ms, elegível: %s', (elapsed, shown) => {
    expect(Boolean(select(elapsed))).toBe(shown)
  })
  it.each(['meal_end', 'unconfirmed', undefined] as const)('não utiliza referência %s', timeReference => {
    expect(select(150 * minute, [], [{ ...meal, timeReference }])).toBeUndefined()
  })
  it('usa somente at, sem substituir pelo horário de criação, edição ou pelo dia local', () => {
    expect(select(150 * minute)).toEqual(meal)
    expect(select(150 * minute, [], [{ ...meal, at: new Date(start + 60 * minute).toISOString(), createdAt: meal.at }])).toBeUndefined()
    const midnight = Date.parse('2026-10-24T01:30:00-03:00')
    const previousDay = { ...meal, at: '2026-10-23T23:00:00-03:00' }
    expect(selectPostMealReminder({ meals: [previousDay], glucose: [], now: midnight })).toEqual(previousDay)
  })
  it.each(['inválido', '2026-10-23', '2026-10-23T12:00', '2026-02-30T12:00:00Z', '2026-10-23T24:00:00Z', '2026-10-23T12:60:00Z', '2026-10-23T12:00:00+25:00'])('ignora horário inválido ou incompleto %s', at => {
    expect(reminderInstant(at)).toBeUndefined()
    expect(select(150 * minute, [], [{ ...meal, at }])).toBeUndefined()
  })
  it('não utiliza refeições futuras nem relógio inválido', () => {
    expect(select(-1)).toBeUndefined()
    expect(selectPostMealReminder({ meals: [meal], glucose: [], now: NaN })).toBeUndefined()
  })
  it.each([[90 * minute - 1, true], [90 * minute, false], [120 * minute, false], [150 * minute, false], [151 * minute, true]] as const)('medição em %s ms: mantém lembrete %s', (measured, shown) => {
    expect(Boolean(select(150 * minute, [{ at: new Date(start + measured).toISOString() }]))).toBe(shown)
  })
  it('não exige mealId nem modifica medição ou refeição para suprimir o aviso', () => {
    const glucose = { at: new Date(start + 95 * minute).toISOString(), mealId: 'outra-refeicao', value: 110 }
    const before = structuredClone({ meal, glucose })
    expect(select(150 * minute, [glucose])).toBeUndefined()
    expect({ meal, glucose }).toEqual(before)
  })
  it('ignora datas incompletas ou inválidas nas medições', () => {
    expect(select(150 * minute, [{ at: '2026-10-23' }, { at: 'inválido' }])).toEqual(meal)
  })
  it('seleciona somente o início elegível mais recente e não encadeia avisos após dispensa', () => {
    const latest = { ...meal, id: 'latest', at: new Date(start + 20 * minute).toISOString() }
    expect(select(150 * minute, [], [meal, latest])).toEqual(latest)
    expect(selectPostMealReminder({ meals: [meal, latest], glucose: [], now: start + 150 * minute, dismissedIds: new Set([latest.id]) })).toBeUndefined()
  })
  it('respeita desativação e o conjunto de dispensas equivalentes fornecido pela interface', () => {
    expect(selectPostMealReminder({ meals: [meal], glucose: [], now: start + 150 * minute, enabled: false })).toBeUndefined()
    expect(selectPostMealReminder({ meals: [meal], glucose: [], now: start + 150 * minute, dismissedIds: new Set([meal.id]) })).toBeUndefined()
  })
  it('identifica dispensas pelo instante e referência, sem depender de descrição ou edição', () => {
    const descriptionEdit = { ...meal, description: 'Descrição corrigida', updatedAt: '2026-10-23T14:20:00Z' }
    expect(postMealDismissalValue(descriptionEdit)).toBe(postMealDismissalValue(meal))
    expect(postMealDismissalValue({ ...meal, at: '2026-10-23T09:00:00-03:00' })).toBe(postMealDismissalValue(meal))
    expect(postMealDismissalValue({ ...meal, at: new Date(start + minute).toISOString() })).not.toBe(postMealDismissalValue(meal))
    expect(postMealDismissalValue({ ...meal, timeReference: 'meal_end' })).not.toBe(postMealDismissalValue(meal))
    expect(postMealDismissalValue({ ...meal, timeReference: 'unconfirmed' })).not.toBe(postMealDismissalValue(meal))
  })
  it('agenda atualização nos limites exatos de 2 e 3 horas e limita a espera a 30 segundos', () => {
    expect(nextPostMealCheck([meal], start + postMealWindow.showFrom - 1)).toBe(1)
    expect(nextPostMealCheck([meal], start + postMealWindow.hideFrom - 1)).toBe(1)
    expect(nextPostMealCheck([meal], start)).toBe(30_000)
  })
  it('compara instantes equivalentes com offsets diferentes', () => {
    const local = { ...meal, at: '2026-10-23T09:00:00-03:00' }
    expect(select(150 * minute, [], [local])).toEqual(local)
    expect(select(150 * minute, [{ at: '2026-10-23T10:30:00-03:00' }], [local])).toBeUndefined()
  })
})
