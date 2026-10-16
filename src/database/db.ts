import Dexie, { type Table } from 'dexie'
export type ID = string
export type Profile = { id: ID; name: string; diagnosis?: string; workoutActivities?: string[]; basalUsage?: 'yes'|'no'|'later'; basalFrequency?: 'daily'|'other'; basalReminderEnabled?: boolean; basalReminderTime?: string; basalMedicationId?: string; basalMedicationName?: string; rapidUsage?: 'yes'|'no'|'later'; rapidMedicationId?: string; rapidMedicationName?: string; createdAt: string; updatedAt: string }
type Base = { id: ID; createdAt: string; updatedAt: string }
export type Meal = Base & { kind: string; at: string; description?: string }
export type Glucose = Base & { value: number; at: string; context?: string; note?: string; mealId?: ID; episodeId?: ID }
export type Insulin = Base & { kind: 'Rápida'|'Basal/lenta'; dose: number; at: string; note?: string; mealId?: ID; medicationId?: string; medicationName?: string; medicationKey?: string }
export type Workout = Base & { activity: string; startedAt: string; endedAt?: string; note?: string; source?: string; externalReference?: string }
export type Episode = Base & { startedAt: string; endedAt?: string; symptoms: string[]; note?: string }
export type Appointment = Base & { at: string; attendanceType?: 'general'|'endocrinologist'|'nutritionist'|'ophthalmologist'|'other'; attendanceTypeOther?: string; professional?: string; location?: string; note?: string }
export class GlicopontoDB extends Dexie {
 profiles!: Table<Profile>; meals!: Table<Meal>; glucose!: Table<Glucose>; insulin!: Table<Insulin>; workouts!: Table<Workout>; episodes!: Table<Episode>; appointments!: Table<Appointment>
 constructor(name = import.meta.env.MODE === 'test' ? 'glicoponto-tests' : import.meta.env.VITE_DB_NAME || 'glicoponto'){
  super(name)
  this.version(1).stores({profiles:'id', meals:'id,at', glucose:'id,at,mealId,episodeId', insulin:'id,at,mealId', workouts:'id,startedAt', episodes:'id,startedAt', appointments:'id,at'})
  // Somente um índice adicional. Nenhum registro precisa ser reescrito.
  this.version(2).stores({insulin:'id,at,mealId,medicationKey'})
 }
}
export const db = new GlicopontoDB()
export const id = (): string => {
 if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
 // getRandomValues também está disponível em HTTP; preserve UUID v4 e IDs existentes.
 const bytes = crypto.getRandomValues(new Uint8Array(16))
 bytes[6] = (bytes[6] & 15) | 64
 bytes[8] = (bytes[8] & 63) | 128
 const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
export const now = () => new Date().toISOString()
export const stamp = <T extends object>(record:T): T & Base => ({...record, id:id(), createdAt:now(), updatedAt:now()})
