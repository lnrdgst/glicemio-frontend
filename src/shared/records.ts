import type { Insulin, Meal } from '../database/db'

export const cleanName = (value: string) => value.trim().replace(/\s+/g, ' ')
export const normalizedName = (value: string) => cleanName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
export function activitySuggestions(values: string[]) {
  const unique = new Map<string, string>()
  const legibility = (name: string) => (name !== name.toLocaleUpperCase('pt-BR') ? 2 : 0) + (name.normalize('NFD') !== name ? 1 : 0)
  values.forEach(value => {
    const name = cleanName(value), key = normalizedName(name), existing = unique.get(key)
    if (name && (!existing || legibility(name) > legibility(existing))) unique.set(key, name)
  })
  return Array.from(unique.values())
}
export const parseActivities = (value: string) => activitySuggestions(value.split(/[\n,;]/))
export function suggestedMealKind(localDateTime: string) {
  const hour = Number(localDateTime.slice(11, 13))
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined
  if (hour < 10) return 'Café da manhã'
  if (hour < 15) return 'Almoço'
  if (hour < 18) return 'Lanche'
  return 'Jantar'
}
export function recentMeal(meals: Meal[], at: string) {
  const measured = new Date(at).getTime()
  return meals.filter(meal => { const elapsed = measured - new Date(meal.at).getTime(); return elapsed >= 0 && elapsed <= 3 * 60 * 60 * 1000 })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
}
export function mealAssociationOptions(meals: Meal[], at: string, preservedMealId?: string) {
  const atTime = new Date(at).getTime()
  const recent = Number.isFinite(atTime) ? meals.filter(meal => new Date(meal.at).getTime() <= atTime).sort((first, second) => +new Date(second.at) - +new Date(first.at)).slice(0, 3) : []
  const preserved = preservedMealId ? meals.find(meal => meal.id === preservedMealId) : undefined
  return preserved && !recent.some(meal => meal.id === preserved.id) ? [...recent, preserved] : recent
}
export type Medication = { id: string; name: string; brands: string; kind: Insulin['kind']; pharmacologicalClass: string }
export const insulinCatalog: readonly Medication[] = [
  { id: 'nph', name: 'NPH', brands: 'Humulin N / Novolin N', kind: 'Basal/lenta', pharmacologicalClass: 'Humana de ação intermediária' },
  { id: 'glargine-u100', name: 'Glargina U100', brands: 'Lantus / Basaglar', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação longa' },
  { id: 'glargine-u300', name: 'Glargina U300', brands: 'Toujeo', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação prolongada' },
  { id: 'degludec', name: 'Degludeca', brands: 'Tresiba', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação ultralonga' },
  { id: 'detemir', name: 'Detemir', brands: 'Levemir', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação longa' },
  { id: 'regular', name: 'Regular', brands: 'Humulin R / Novolin R', kind: 'Rápida', pharmacologicalClass: 'Humana de ação curta' },
  { id: 'lispro', name: 'Lispro', brands: 'Humalog', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'aspart', name: 'Asparte', brands: 'NovoRapid', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'glulisine', name: 'Glulisina', brands: 'Apidra', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'faster-aspart', name: 'Asparte ultrarrápida', brands: 'Fiasp', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação ultrarrápida' },
  { id: 'nph-humulin-n', name: 'Humulin N', brands: 'NPH', kind: 'Basal/lenta', pharmacologicalClass: 'Humana de ação intermediária' },
  { id: 'nph-novolin-n', name: 'Novolin N', brands: 'NPH', kind: 'Basal/lenta', pharmacologicalClass: 'Humana de ação intermediária' },
  { id: 'glargine-u100-lantus', name: 'Lantus', brands: 'Glargina U100', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação longa' },
  { id: 'glargine-u100-basaglar', name: 'Basaglar', brands: 'Glargina U100', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação longa' },
  { id: 'glargine-u300-toujeo', name: 'Toujeo', brands: 'Glargina U300', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação prolongada' },
  { id: 'degludec-tresiba', name: 'Tresiba', brands: 'Degludeca', kind: 'Basal/lenta', pharmacologicalClass: 'Análogo de ação ultralonga' },
  { id: 'lispro-humalog', name: 'Humalog', brands: 'Lispro', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'aspart-novorapid', name: 'NovoRapid', brands: 'Asparte', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'glulisine-apidra', name: 'Apidra', brands: 'Glulisina', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
  { id: 'faster-aspart-fiasp', name: 'Fiasp', brands: 'Asparte ultrarrápida', kind: 'Rápida', pharmacologicalClass: 'Análogo de ação rápida' },
]
export const medicationIdentity = (id: string, name: string) => !id ? undefined : id === 'other' ? (cleanName(name) ? `other:${normalizedName(name)}` : undefined) : id
export const insulinName = (record: Insulin) => record.medicationName || insulinCatalog.find(x => x.id === record.medicationId)?.name
export function previousInsulin(records: Insulin[], key?: string, kind?: Insulin['kind']) {
  if (!key) return undefined
  return records.filter(x => x.medicationKey === key && (!kind || x.kind === kind)).sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
}
