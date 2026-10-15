import { localDayKey } from './format'

type Input = { enabled?: boolean; time?: string; now: Date; lastBasalAt?: string; basalToday: boolean; laterUntil?: number; ignoredDay?: string }
export function shouldShowBasalReminder({ enabled, time, now, lastBasalAt, basalToday, laterUntil, ignoredDay }: Input) {
  if (!enabled || !time || basalToday || ignoredDay === localDayKey(now.toISOString()) || (laterUntil && laterUntil > now.getTime())) return false
  const [hours, minutes] = time.split(':').map(Number); const scheduled = new Date(now); scheduled.setHours(hours, minutes, 0, 0)
  if (now < scheduled) return false
  return !lastBasalAt || now.getTime() - new Date(lastBasalAt).getTime() >= 24 * 60 * 60 * 1000
}
