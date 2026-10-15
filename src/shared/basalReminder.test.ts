import { describe, expect, it } from 'vitest'
import { shouldShowBasalReminder } from './basalReminder'

const now = new Date(2026, 9, 15, 21, 0)
describe('lembrete basal', () => {
  it('permanece desligado até configuração explícita e não aparece antes do horário informado', () => {
    expect(shouldShowBasalReminder({ enabled: false, time: '21:00', now, basalToday: false })).toBe(false)
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now: new Date(2026, 9, 15, 20, 59), basalToday: false })).toBe(false)
  })
  it('exige 24 horas desde a última basal e não presume ausência de aplicação', () => {
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now, basalToday: false, lastBasalAt: new Date(2026, 9, 14, 21, 1).toISOString() })).toBe(false)
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now, basalToday: false, lastBasalAt: new Date(2026, 9, 14, 20, 59).toISOString() })).toBe(true)
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now, basalToday: true })).toBe(false)
  })
  it('respeita adiamento e dispensa no dia local', () => {
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now, basalToday: false, laterUntil: now.getTime() + 1 })).toBe(false)
    expect(shouldShowBasalReminder({ enabled: true, time: '21:00', now, basalToday: false, ignoredDay: '2026-10-15' })).toBe(false)
  })
})
