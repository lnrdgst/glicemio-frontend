import { expect, it } from 'vitest'
import { isWithinReportInterval, parseReportPeriod, reportInterval } from './reportPeriod'

it.each(['today', '7', '30', '90'])('interpreta o período %s da URL', value => {
  expect(parseReportPeriod(value)).toBe(value === 'today' ? 'today' : Number(value))
})

it.each([null, '', '0', '24', 'invalid'])('mantém 30 dias como padrão para %s', value => {
  expect(parseReportPeriod(value)).toBe(30)
})

it('Hoje usa meia-noite local e inclui somente até o instante atual, sem usar últimas 24h', () => {
  const current = new Date(2026, 9, 24, 13, 45)
  const midnight = new Date(2026, 9, 24).getTime()
  const interval = reportInterval('today', current)
  expect(interval).toEqual({ from: midnight, to: current.getTime() })
  expect(isWithinReportInterval(new Date(midnight - 1).toISOString(), interval)).toBe(false)
  expect(isWithinReportInterval(new Date(midnight).toISOString(), interval)).toBe(true)
  expect(isWithinReportInterval(current.toISOString(), interval)).toBe(true)
  expect(isWithinReportInterval(new Date(current.getTime() + 1).toISOString(), interval)).toBe(false)
  expect(isWithinReportInterval('invalid', interval)).toBe(false)
})

it('recomeça Hoje à meia-noite na virada do mês e do ano', () => {
  const midnight = new Date(2027, 0, 1)
  expect(reportInterval('today', midnight)).toEqual({ from: midnight.getTime(), to: midnight.getTime() })
  expect(isWithinReportInterval(new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(), reportInterval('today', midnight))).toBe(false)
})

it.each([7, 30, 90] as const)('preserva a janela móvel anterior de %s dias', days => {
  const current = new Date(2026, 9, 24, 13, 45)
  const interval = reportInterval(days, current)
  expect(interval.from).toBe(current.getTime() - days * 86400000)
  expect(isWithinReportInterval(new Date(interval.from).toISOString(), interval)).toBe(true)
  expect(isWithinReportInterval(new Date(interval.from - 1).toISOString(), interval)).toBe(false)
})
