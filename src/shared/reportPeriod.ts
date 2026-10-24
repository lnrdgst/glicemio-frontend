export type ReportPeriod = 'today' | 7 | 30 | 90

export function parseReportPeriod(value: string | null): ReportPeriod {
  if (value === 'today') return 'today'
  const days = Number(value)
  return days === 7 || days === 30 || days === 90 ? days : 30
}

export function reportInterval(period: ReportPeriod, reference = new Date()) {
  const current = reference.getTime()
  return {
    from: period === 'today' ? new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime() : current - period * 86400000,
    // Os filtros móveis mantêm o comportamento anterior; Hoje termina no instante atual.
    to: period === 'today' ? current : Infinity,
  }
}

export function isWithinReportInterval(value: string, interval: ReturnType<typeof reportInterval>) {
  const instant = Date.parse(value)
  return Number.isFinite(instant) && instant >= interval.from && instant <= interval.to
}
