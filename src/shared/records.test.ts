import { describe, expect, it } from 'vitest'
import { activitySuggestions, glucoseContextSuggestion, insulinCatalog, mealAssociationOptions, medicationIdentity, parseActivities, previousInsulin, recentMeal, suggestedMealKind } from './records'
import { stamp } from '../database/db'
import { duration, iso, localInput } from './format'

describe('regras locais', () => {
  it('mantém identidades estáveis do catálogo, sem misturas', () => {
    expect(insulinCatalog).toHaveLength(20)
    expect(new Set(insulinCatalog.map(x => x.id)).size).toBe(20)
    expect(insulinCatalog.filter(x => x.kind === 'Basal/lenta')).toHaveLength(11)
    expect(insulinCatalog.find(x => x.id === 'nph')?.pharmacologicalClass).toContain('intermediária')
    expect(insulinCatalog.find(x => x.id === 'regular')?.pharmacologicalClass).toContain('curta')
    expect(insulinCatalog.find(x => x.id === 'glargine-u100-basaglar')).toMatchObject({ name: 'Basaglar', brands: 'Glargina U100' })
    expect(insulinCatalog.find(x => x.id === 'lispro-humalog')).toMatchObject({ name: 'Humalog', brands: 'Lispro' })
  })
  it('deduplica modalidades sem acentos, caixa ou espaços, preservando apresentação', () => {
    expect(activitySuggestions([' Musculação ', 'musculacao', 'MUSCULAÇÃO', '  Caminhada   leve ', ''])).toEqual(['Musculação', 'Caminhada leve'])
    expect(parseActivities('Natação; natacao, Yoga\nyoga')).toEqual(['Natação', 'Yoga'])
  })
  it('a identidade de Outra usa nome normalizado, sem misturar insulinas distintas', () => {
    expect(medicationIdentity('other', '  FÓRMULA  A ')).toBe(medicationIdentity('other', 'formula a'))
    expect(medicationIdentity('other', 'Fórmula A')).not.toBe(medicationIdentity('other', 'Fórmula B'))
    expect(medicationIdentity('other', '')).toBeUndefined()
  })
  it('usa janela inclusiva e ordena por horário efetivo sem modificar refeições', () => {
    const meals = [stamp({ kind: 'Almoço', at: iso('2026-10-14T12:00') }), stamp({ kind: 'Lanche', at: iso('2026-10-14T11:00') })]
    const copy = structuredClone(meals)
    expect(recentMeal(meals, '2026-10-14T15:00')?.kind).toBe('Almoço')
    expect(recentMeal(meals, '2026-10-14T15:01')).toBeUndefined()
    expect(meals).toEqual(copy)
  })
  it('sugere o acontecimento mais recente pelo horário efetivo', () => {
    const meal = stamp({ kind: 'Almoço', at: iso('2026-10-14T15:00') })
    const workout = stamp({ activity: 'Caminhada', startedAt: iso('2026-10-14T13:00'), endedAt: iso('2026-10-14T14:00') })
    expect(glucoseContextSuggestion([meal], [workout], '2026-10-14T16:00')).toBe('Após refeição')
    expect(glucoseContextSuggestion([meal], [{ ...workout, endedAt: iso('2026-10-14T15:30') }], '2026-10-14T16:00')).toBe('Após treino')
    expect(glucoseContextSuggestion([], [{ ...workout, endedAt: undefined }], '2026-10-14T16:00')).toBeUndefined()
    expect(glucoseContextSuggestion([], [workout], '2026-10-14T17:01')).toBeUndefined()
  })
  it('limita associações às três refeições anteriores e preserva somente o vínculo em edição', () => {
    const meals = [8, 9, 10, 11, 14].map(hour => stamp({ kind: `Refeição ${hour}`, at: iso(`2026-10-14T${String(hour).padStart(2, '0')}:00`) }))
    const options = mealAssociationOptions(meals, '2026-10-14T12:00')
    expect(options.map(meal => meal.kind)).toEqual(['Refeição 11', 'Refeição 10', 'Refeição 9'])
    expect(mealAssociationOptions(meals, '2026-10-14T12:00', meals[0].id).map(meal => meal.kind)).toEqual(['Refeição 11', 'Refeição 10', 'Refeição 9', 'Refeição 8'])
  })
  it.each([['2026-10-14T09:59', 'Café da manhã'], ['2026-10-14T10:00', 'Almoço'], ['2026-10-14T14:59', 'Almoço'], ['2026-10-14T15:00', 'Lanche'], ['2026-10-14T17:59', 'Lanche'], ['2026-10-14T18:00', 'Jantar'], ['2026-10-14T23:59', 'Jantar']])('sugere %s para %s', (at, expected) => {
    expect(suggestedMealKind(at)).toBe(expected)
  })
  it('não usa dose de registros legados sem identidade', () => {
    expect(previousInsulin([stamp({ kind: 'Rápida', dose: 12, at: iso('2026-10-14T12:00') })], 'lispro')).toBeUndefined()
  })
  it('converte local/ISO sem deslocar horário e rejeita datas vazias ou normalizadas', () => {
    expect(localInput(iso('2026-10-14T21:15'))).toBe('2026-10-14T21:15')
    expect(() => iso('')).toThrow(); expect(() => iso('2026-02-30T12:00')).toThrow()
    expect(duration(iso('2026-10-14T23:30'), iso('2026-10-15T00:30'))).toBe('60 min')
    expect(duration(iso('2026-10-14T23:30'))).toBe('Em andamento')
  })
})
