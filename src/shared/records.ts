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
export function recentMeal(meals: Meal[], at: string) {
  const measured = new Date(at).getTime()
  return meals.filter(meal => { const elapsed = measured - new Date(meal.at).getTime(); return elapsed >= 0 && elapsed <= 3 * 60 * 60 * 1000 })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
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
]
export const medicationIdentity = (id: string, name: string) => !id ? undefined : id === 'other' ? (cleanName(name) ? `other:${normalizedName(name)}` : undefined) : id
export const insulinName = (record: Insulin) => record.medicationName || insulinCatalog.find(x => x.id === record.medicationId)?.name
export function previousInsulin(records: Insulin[], key?: string, kind?: Insulin['kind']) {
  if (!key) return undefined
  return records.filter(x => x.medicationKey === key && (!kind || x.kind === kind)).sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
}
