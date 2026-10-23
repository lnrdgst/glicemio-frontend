import * as React from 'react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronRight, Droplets, Dumbbell, Pencil, Plus, Soup, Stethoscope, Syringe, Trash2, TriangleAlert, Utensils, type LucideIcon } from 'lucide-react'
import { db, now, stamp, type Appointment, type Insulin, type Meal } from './database/db'
import { exportBackup, previewBackup, restoreBackup, type ImportPreview, type ProfileStrategy } from './database/backup'
import { RecordForm, type RecordKind } from './RecordForm'
import { ProfileForm } from './ProfileForm'
import { BrandLogo } from './shared/BrandLogo'
import { MealTimeReferenceReview } from './MealTimeReferenceReview'
import { PostMealReminder } from './PostMealReminder'
import { mealTimeReferenceLabel } from './shared/meals'
import { insulinName } from './shared/records'
import { classifyGlucose, glucoseSummary, hypoglycemiaGuidance } from './shared/glucose'
import { shouldShowBasalReminder } from './shared/basalReminder'
import { Button, Layout, scrollToTop, usePersistence } from './shared/ui'
import { appointmentCountdown, appointmentDateTime, dateTime, dayHeading, duration, eventDateTime, localDayKey, time } from './shared/format'

type HomeActionTone = 'glucose' | 'meal' | 'insulin' | 'workout' | 'appointment' | 'symptoms'
type HomeQuickAction = { label: string; to: string; tone: HomeActionTone; Icon: LucideIcon }
const homeQuickActions: HomeQuickAction[] = [
  { label: 'Registrar glicemia', to: '/glicemia', tone: 'glucose', Icon: Droplets },
  { label: 'Registrar refeição', to: '/refeicao', tone: 'meal', Icon: Utensils },
  { label: 'Registrar insulina', to: '/insulina', tone: 'insulin', Icon: Syringe },
  { label: 'Registrar treino', to: '/treino', tone: 'workout', Icon: Dumbbell },
  { label: 'Registrar consulta', to: '/consulta', tone: 'appointment', Icon: Stethoscope },
  { label: 'Registrar sintomas', to: '/episodio', tone: 'symptoms', Icon: TriangleAlert },
]

function HomeTitle({ tone, children }: { tone: HomeActionTone; children: ReactNode }) {
  const Icon = homeQuickActions.find(action => action.tone === tone)!.Icon
  return <span className="home-title"><Icon className={`home-title-icon home-title-icon-${tone}`} size={18} aria-hidden="true" /><span>{children}</span></span>
}

function HomeHistoryTitle({ tone, filter, children }: { tone: Exclude<HomeActionTone, 'symptoms'>; filter: 'glucose' | 'insulin' | 'meals' | 'workouts' | 'appointments'; children: ReactNode }) {
  return <Link className={`home-title-link home-title-link-${tone}`} to={`/historico?tipo=${filter}`}><HomeTitle tone={tone}>{children}</HomeTitle><ChevronRight size={17} aria-hidden="true" /></Link>
}

function QuickActions() {
  return <section className="quick-actions" aria-labelledby="quick-actions-title"><p id="quick-actions-title">Ações rápidas</p><div className="quick-actions-grid">{homeQuickActions.map(({ label, to, tone, Icon }) => <Link key={tone} to={to} className={`quick-action quick-action-${tone}`} aria-label={label} title={label}><Icon size={21} aria-hidden="true" /></Link>)}</div></section>
}

const symptoms = ['Tremor', 'Suor', 'Fraqueza', 'Tontura', 'Palpitação', 'Confusão', 'Outro']
const detailsFor: Record<string, { title: string; edit: string }> = {
  glucose: { title: 'Glicemia', edit: 'glicemia' }, meals: { title: 'Refeição', edit: 'refeicao' },
  insulin: { title: 'Aplicação de insulina', edit: 'insulina' }, workouts: { title: 'Treino', edit: 'treino' },
  appointments: { title: 'Consulta', edit: 'consulta' }, episodes: { title: 'Episódio de sintomas', edit: 'episodio' },
}
const attendanceLabel = (record: any) => (record.attendanceType === 'other' ? record.attendanceTypeOther || 'Outro' : ({ general: 'Clínico geral', endocrinologist: 'Endocrinologista', nutritionist: 'Nutricionista', ophthalmologist: 'Oftalmologista' } as Record<string, string>)[record.attendanceType] || '')
const appointmentSummary = (record: any) => [attendanceLabel(record), record.professional].filter(Boolean).join(' · ') || 'Profissional não informado'

function Delete({ run, onDeleted }: { run: () => Promise<void>; onDeleted: () => void }) {
  const { run: persist, saving, error } = usePersistence(); const [confirming, setConfirming] = useState(false)
  const remove = () => void persist(async () => { await run(); onDeleted() })
  return <span className="details-delete">{confirming ? <div className="delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="delete-record-title"><p id="delete-record-title"><b>Excluir este registro?</b></p><p className="muted">Esta ação não poderá ser desfeita.</p><div className="actions"><button type="button" className="secondary" disabled={saving} onClick={() => setConfirming(false)}>Cancelar</button><button type="button" className="danger" disabled={saving} onClick={remove}><Trash2 size={18} aria-hidden="true" />{saving ? 'Excluindo…' : 'Excluir registro'}</button></div></div> : <button type="button" className="danger" onClick={() => setConfirming(true)}><Trash2 size={18} aria-hidden="true" />Excluir</button>}{error && <span role="alert">Não foi possível excluir o registro. Tente novamente.</span>}</span>
}

function Onboarding() {
  const nav = useNavigate()
  return <main className="shell onboarding"><section className="card"><BrandLogo /><h1>Vamos começar pelo essencial.</h1><p className="muted">Seus registros ficam neste dispositivo durante esta versão de desenvolvimento.</p><ProfileForm onSaved={() => nav('/', { replace: true })} /><BackupActions onRestored={() => nav('/', { replace: true })} /></section></main>
}

function useProfile() { return useLiveQuery(() => db.profiles.get('local').then(value => value ?? null), []) }

function Home() {
  const location = useLocation(); const profile = useProfile()
  const glucose = useLiveQuery(() => db.glucose.orderBy('at').last(), [])
  const linkedMeal = useLiveQuery(async () => glucose?.mealId ? db.meals.get(glucose.mealId) : undefined, [glucose?.mealId])
  const meals = useLiveQuery(() => db.meals.orderBy('at').reverse().limit(3).toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.orderBy('startedAt').reverse().limit(3).toArray(), []) ?? []
  const appointments = useLiveQuery(() => db.appointments.orderBy('at').toArray(), []) ?? []
  const insulin = useLiveQuery(() => db.insulin.orderBy('at').reverse().toArray(), []) ?? []
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => { const update = () => setClock(new Date()); const timer = window.setInterval(update, 30000); document.addEventListener('visibilitychange', update); return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) } }, [])
  const todayKey = localDayKey(clock.toISOString()); const todayGlucose = useLiveQuery(() => db.glucose.filter(item => localDayKey(item.at) === todayKey).toArray(), [todayKey]) ?? []
  const glucoseState = glucose ? classifyGlucose(glucose.value) : undefined; const glucoseGuidance = glucoseState ? hypoglycemiaGuidance(glucoseState) : undefined; const glucoseContext = glucose?.context && glucose.context !== 'Não informado' ? glucose.context : undefined; const glucoseContextLabel = linkedMeal ? glucoseContext ? `${glucoseContext} · ${linkedMeal.kind}` : linkedMeal.kind : glucoseContext; const dailySummary = glucoseSummary(todayGlucose.map(item => item.value)); const insulinContext = glucose ? { basal: insulin.find(item => item.kind === 'Basal/lenta'), rapid: insulin.find(item => item.kind === 'Rápida') } : undefined; const upcomingAppointments = appointments.filter(appointment => new Date(appointment.at) > clock).slice(0, 2); const imminentAppointment = upcomingAppointments.find(appointment => new Date(appointment.at).getTime() - clock.getTime() <= 24 * 60 * 60 * 1000)
  if (profile === undefined) return <main className="shell" />
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Layout>{location.state?.success && <p role="status">{location.state.success}</p>}<header><BrandLogo /><h1 style={{ marginBottom: 4 }}>Olá, {profile.name}</h1>{profile.diagnosis && <p className="muted">{profile.diagnosis}</p>}</header>
    <QuickActions />
    {imminentAppointment && <ImminentAppointment appointment={imminentAppointment} reference={clock} />}
    <BasalReminder profile={profile} insulin={insulin} now={clock} fallback={!glucoseGuidance && glucoseState?.id !== 'high-attention' && !imminentAppointment ? <PostMealReminder enabled={profile.postMealReminderEnabled !== false} /> : null} />
    {glucose && glucoseState ? <section className="home-section glucose-section"><section className="home-record card glucose-card" style={{ '--glucose-status-color': glucoseState.color } as React.CSSProperties}><div className="glucose-card-heading"><HomeHistoryTitle tone="glucose" filter="glucose">Última medição</HomeHistoryTitle><AddRecordLink to="/glicemia" label="Registrar glicemia" tone="glucose" /></div><Link className="home-glucose-detail" to={`/detalhes/glucose/${glucose.id}`}><h2 style={{ fontSize: '2.3rem', margin: '6px 0' }}>{glucose.value} <small>mg/dL</small></h2><p className="muted glucose-card-date">{eventDateTime(glucose.at)}</p><p className="glucose-status">{glucoseState.label}</p>{glucoseContextLabel && <p className="muted">{glucoseContextLabel}</p>}</Link>{todayGlucose.length >= 2 && dailySummary && <DailyGlucoseSummary count={todayGlucose.length} summary={dailySummary} />}{glucoseGuidance && <p className="glucose-guidance">{glucoseGuidance}</p>}<GlucoseInsulinContext basal={insulinContext?.basal} rapid={insulinContext?.rapid} glucoseAt={glucose.at} /></section></section> : <section className="home-section glucose-section"><section className="card home-record glucose-empty-card"><div className="glucose-card-heading"><h2><HomeHistoryTitle tone="glucose" filter="glucose">Nenhuma medição ainda</HomeHistoryTitle></h2><AddRecordLink to="/glicemia" label="Registrar glicemia" tone="glucose" /></div><p className="muted">Registre seu primeiro Ponto para acompanhar seu contexto.</p><GlucoseInsulinContext basal={insulinContext?.basal} rapid={insulinContext?.rapid} /></section></section>}
    <HomeList title="Últimas refeições" empty="Nenhuma refeição registrada." items={meals} render={(record: Meal) => <><span>{record.kind}</span><span className="muted">{eventDateTime(record.at)} · {mealTimeReferenceLabel(record)}</span></>} table="meals" filter="meals" createTo="/refeicao" createLabel="Registrar refeição" tone="meal" />
    <HomeList title="Últimos treinos" empty="Nenhum treino registrado." items={workouts} render={record => <><span>{record.activity}</span><span className="muted">{duration(record.startedAt, record.endedAt)}</span></>} table="workouts" filter="workouts" createTo="/treino" createLabel="Registrar treino" tone="workout" />
    <HomeAppointments appointments={upcomingAppointments} reference={clock} />
  </Layout>
}

function DailyGlucoseSummary({ count, summary }: { count: number; summary: NonNullable<ReturnType<typeof glucoseSummary>> }) {
  const indicators = [['Mínima', summary.minimum], ['Máxima', summary.maximum], ['Média', Math.round(summary.average)]]
  return <section className="daily-glucose-summary" aria-label="Resumo glicêmico de hoje"><div className="daily-glucose-heading"><span>Resumo de hoje</span><span>{count} {count === 1 ? 'medição' : 'medições'}</span></div><dl>{indicators.map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{value} <small>mg/dL</small></dd></div>)}</dl><p className="muted">A média considera somente as medições registradas hoje.</p></section>
}

function AddRecordLink({ to, label, tone }: { to: string; label: string; tone: Exclude<HomeActionTone, 'symptoms'> }) {
  return <Link className={`home-add home-add-${tone}`} to={to} aria-label={label}><Plus size={22} aria-hidden="true" /></Link>
}

function GlucoseInsulinContext({ basal, rapid, glucoseAt }: { basal?: Insulin; rapid?: Insulin; glucoseAt?: string }) {
  const applications = [{ label: 'Basal', application: basal }, { label: 'Rápida', application: rapid }].filter((item): item is { label: string; application: Insulin } => Boolean(item.application)).sort((first, second) => new Date(second.application.at).getTime() - new Date(first.application.at).getTime())
  return <section className="glucose-insulin-context" aria-label="Últimas aplicações registradas"><div className="glucose-insulin-heading"><p><HomeHistoryTitle tone="insulin" filter="insulin">Últimas aplicações registradas</HomeHistoryTitle></p><AddRecordLink to="/insulina" label="Registrar insulina" tone="insulin" /></div>{applications.length ? applications.map(({ label, application }) => <Link className="glucose-insulin-context-line" key={application.id} to={`/detalhes/insulin/${application.id}`}><div><b>{label}</b>{insulinName(application) && <span>{insulinName(application)}</span>}<small>{eventDateTime(application.at)}</small>{glucoseAt && new Date(application.at) > new Date(glucoseAt) && <small className="glucose-insulin-after">Aplicada após a última medição</small>}</div><strong>{application.dose.toLocaleString('pt-BR')} UI</strong></Link>) : <p className="muted glucose-insulin-empty">Nenhuma aplicação registrada.</p>}</section>
}

function BasalReminder({ profile, insulin, now: current, fallback }: { profile: any; insulin: any[]; now: Date; fallback?: ReactNode }) {
  const nav = useNavigate(); const basal = insulin.filter(item => item.kind === 'Basal/lenta'); const last = basal[0]; const today = current.toLocaleDateString('en-CA'); const key = 'glicoponto-basal-reminder'
  const [, refresh] = useState(0)
  const state = (() => { try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} } })(); const show = shouldShowBasalReminder({ enabled: profile.basalReminderEnabled, time: profile.basalReminderTime, now: current, lastBasalAt: last?.at, basalToday: basal.some(item => new Date(item.at).toLocaleDateString('en-CA') === today), laterUntil: state.laterUntil, ignoredDay: state.ignoredDay })
  if (!show) return fallback ?? null
  const save = (value: object) => { localStorage.setItem(key, JSON.stringify(value)); refresh(value => value + 1) }
  return <section className="card basal-reminder"><b>Insulina basal — lembrete</b><p>Ainda não há registro da sua insulina basal para hoje. Deseja registrar agora?</p>{last && <p className="muted">Último registro: {eventDateTime(last.at)}.</p>}<p className="muted">A ausência de registro não confirma ausência de aplicação.</p><div className="actions"><button className="primary" onClick={() => nav('/insulina')}>Registrar agora</button><button className="secondary" onClick={() => save({ laterUntil: Date.now() + 15 * 60000 })}>Lembrar mais tarde</button><button className="secondary" onClick={() => save({ ignoredDay: today })}>Ignorar hoje</button></div></section>
}

function HomeList({ title, empty, items, render, table, filter, createTo, createLabel, tone }: { title: string; empty: string; items: any[]; render: (item: any) => React.ReactNode; table: string; filter: 'meals' | 'workouts'; createTo: string; createLabel: string; tone: 'meal' | 'workout' }) {
  return <section className="home-section"><div className="card home-list-card"><div className="home-card-heading"><h2><HomeHistoryTitle tone={tone} filter={filter}>{title}</HomeHistoryTitle></h2><AddRecordLink to={createTo} label={createLabel} tone={tone} /></div>{items.length ? items.map(item => <Link className="home-list-item row" key={item.id} to={`/detalhes/${table}/${item.id}`}>{render(item)}</Link>) : <p className="muted">{empty}</p>}</div></section>
}

function HomeAppointments({ appointments, reference }: { appointments: Appointment[]; reference: Date }) {
  return <section className="home-section"><div className="card home-list-card"><div className="home-card-heading"><h2><HomeHistoryTitle tone="appointment" filter="appointments">Próximas consultas</HomeHistoryTitle></h2><AddRecordLink to="/consulta" label="Registrar consulta" tone="appointment" /></div>{appointments.length ? appointments.map(appointment => <Link className="home-appointment" key={appointment.id} to={`/detalhes/appointments/${appointment.id}`}><div><b>{attendanceLabel(appointment) || 'Consulta'}</b>{appointment.professional && <p>{appointment.professional}</p>}<p className="muted">{appointmentDateTime(appointment.at, reference)}</p></div><span className="muted">{appointmentCountdown(appointment.at, reference)}</span></Link>) : <p className="muted home-empty">Nenhuma consulta futura.</p>}</div></section>
}

function ImminentAppointment({ appointment, reference }: { appointment: Appointment; reference: Date }) {
  return <Link className="card imminent-appointment" to={`/detalhes/appointments/${appointment.id}`}><span className="imminent-appointment-title"><CalendarDays size={18} aria-hidden="true" /> Consulta em breve</span><div><b>{attendanceLabel(appointment) || 'Consulta'}</b>{appointment.professional && <span className="muted"> · {appointment.professional}</span>}</div><div className="imminent-appointment-details"><span>{appointmentDateTime(appointment.at, reference)}</span><strong>{appointmentCountdown(appointment.at, reference)}</strong></div></Link>
}

function Episode() {
  const { id } = useParams(); const nav = useNavigate(); const current = useLiveQuery(() => id ? db.episodes.get(id) : db.episodes.filter(x => !x.endedAt).first(), [id])
  const { run, saving, error } = usePersistence(); const [selected, setSelected] = useState<string[]>([])
  useEffect(() => { setSelected(current?.symptoms ?? []) }, [current?.id])
  const editing = Boolean(id)
  if (editing && current === undefined) return <Layout><h1>Carregando registro…</h1></Layout>
  if (editing && !current) return <Layout><h1>Registro não encontrado</h1></Layout>
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void run(async () => { if (current) { await db.episodes.put({ ...current, symptoms: selected, note: String(form.get('note') || '') || undefined, updatedAt: now() }); nav(editing ? `/detalhes/episodes/${current.id}` : '/episodio', { state: { success: 'Alterações salvas neste dispositivo.' } }) } else { await db.episodes.add(stamp({ startedAt: now(), symptoms: selected, note: String(form.get('note') || '') || undefined })); nav('/episodio', { state: { success: 'Episódio salvo neste dispositivo.' } }) } }) }
  const end = () => void run(async () => { if (current) { await db.episodes.update(current.id, { endedAt: now(), updatedAt: now() }); nav('/') } })
  return <Layout><Link to={editing ? `/detalhes/episodes/${id}` : '/'} className="muted">← Voltar</Link><h1 className="form-title form-title-episodio">{editing ? 'Editar episódio de sintomas' : current ? 'Acompanhando sintomas' : 'Registrar sintomas'}</h1><form onSubmit={save} className="card"><fieldset disabled={saving}><b>Selecione os sintomas</b><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{symptoms.map(symptom => <label key={symptom} className="secondary" style={{ padding: 8 }}><input type="checkbox" checked={selected.includes(symptom)} onChange={event => setSelected(value => event.target.checked ? [...value, symptom] : value.filter(x => x !== symptom))} /> {symptom}</label>)}</div><label className="label">Observações<textarea className="field" name="note" defaultValue={current?.note} /></label><div className="actions"><Button className="form-save form-save-episodio" type="submit">{saving ? 'Salvando…' : editing ? 'Salvar alterações do sintoma' : 'Relatar sintoma'}</Button>{current && !editing && <><Link className="secondary" to={`/glicemia?episode=${current.id}`}>Registrar glicemia</Link><button type="button" className="secondary" onClick={end}>Encerrar episódio</button></>}</div></fieldset>{error && <p role="alert">{error}</p>}</form></Layout>
}

function Details() {
  const { table = '', id = '' } = useParams(); const nav = useNavigate(); const config = detailsFor[table]; const record = useLiveQuery(() => config ? db.table(table).get(id) : Promise.resolve(undefined), [table, id, config]) as any
  if (!config) return <Navigate to="/historico" replace />
  if (record === undefined) return <Layout><h1>Carregando registro…</h1></Layout>
  if (!record) return <Layout><Link to="/" className="muted">← Início</Link><section className="card"><h1>Registro não encontrado</h1></section></Layout>
  const at = record.at || record.startedAt
  const detail = table === 'glucose' ? `${record.value} mg/dL · ${record.context || 'Sem contexto'}` : table === 'insulin' ? `${insulinName(record) || record.kind} · ${record.dose.toLocaleString('pt-BR')} UI` : table === 'meals' ? record.kind : table === 'workouts' ? `${record.activity} · ${duration(record.startedAt, record.endedAt)}` : table === 'episodes' ? record.symptoms.join(', ') || 'Sem sintomas selecionados' : appointmentSummary(record)
  return <Layout><Link to="/" className="muted">← Início</Link><section className={`card details details-${config.edit}`}><div className="details-heading"><h1 className="details-title">{config.title}</h1></div><div className="details-content"><p className="details-primary">{detail}</p><p>{eventDateTime(at)}</p>{table === 'meals' && <p className="muted">{mealTimeReferenceLabel(record)}</p>}{record.note && <p className="muted">{record.note}</p>}{record.description && <p className="muted">{record.description}</p>}</div><div className="details-actions"><Link className="primary details-edit" to={config.edit === 'episodio' ? `/episodio/${id}/editar` : `/${config.edit}/${id}/editar`}><Pencil size={18} aria-hidden="true" />Editar</Link><Delete run={() => (db as any)[table].delete(id)} onDeleted={() => nav(`/historico?tipo=${table}`, { state: { success: 'Registro excluído deste dispositivo.' } })} /></div></section></Layout>
}

type HistoryFilter = 'all' | 'glucose' | 'meals' | 'insulin' | 'workouts' | 'episodes' | 'appointments'
type Line = { id: string; at: string; title: string; detail?: string; table: string; recordId: string }
const historyFilters: { value: HistoryFilter; label: string }[] = [{ value: 'all', label: 'Todos' }, { value: 'glucose', label: 'Glicemias' }, { value: 'meals', label: 'Refeições' }, { value: 'insulin', label: 'Insulinas' }, { value: 'workouts', label: 'Treinos' }, { value: 'episodes', label: 'Episódios' }, { value: 'appointments', label: 'Consultas' }]
const sortLines = (lines: Line[]) => lines.sort((a, b) => +new Date(b.at) - +new Date(a.at) || a.table.localeCompare(b.table) || a.id.localeCompare(b.id))

function History() {
  const location = useLocation(); const [search, setSearch] = useSearchParams(); const requested = historyFilters.some(item => item.value === search.get('tipo')) ? search.get('tipo') as HistoryFilter : 'all'; const [filter, setFilter] = useState<HistoryFilter>(requested); const [shown, setShown] = useState(20); const subtype = search.get('subtipo')
  useEffect(() => { setFilter(requested); setShown(20) }, [requested])
  const history = useLiveQuery(async () => {
    const take = shown + 1
    const [glucose, meals, insulin, workouts, episodes, appointments] = await Promise.all([
      filter === 'all' || filter === 'glucose' ? db.glucose.orderBy('at').reverse().limit(take).toArray() : [],
      filter === 'all' || filter === 'meals' ? db.meals.orderBy('at').reverse().limit(take).toArray() : [],
      filter === 'all' || filter === 'insulin' ? db.insulin.orderBy('at').reverse().limit(take).toArray().then(records => subtype === 'basal' ? records.filter(record => record.kind === 'Basal/lenta') : subtype === 'rapida' ? records.filter(record => record.kind === 'Rápida') : records) : [],
      filter === 'all' || filter === 'workouts' ? db.workouts.orderBy('startedAt').reverse().limit(take).toArray() : [],
      filter === 'all' || filter === 'episodes' ? db.episodes.orderBy('startedAt').reverse().limit(take).toArray() : [],
      filter === 'all' || filter === 'appointments' ? db.appointments.orderBy('at').reverse().limit(take).toArray() : [],
    ])
    const ordered = sortLines([...glucose.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `${x.value} mg/dL`, detail: x.context, table: 'glucose' })), ...meals.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: x.kind, detail: [mealTimeReferenceLabel(x), x.description].filter(Boolean).join(' · '), table: 'meals' })), ...insulin.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `Insulina ${x.kind}`, detail: `${insulinName(x) ? `${insulinName(x)} · ` : ''}${x.dose.toLocaleString('pt-BR')} UI`, table: 'insulin' })), ...workouts.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Treino', detail: x.activity, table: 'workouts' })), ...episodes.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Episódio', detail: x.symptoms.join(', '), table: 'episodes' })), ...appointments.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: 'Consulta', detail: appointmentSummary(x), table: 'appointments' }))])
    return { lines: ordered.slice(0, shown), hasMore: ordered.length > shown }
  }, [filter, shown, subtype]) ?? { lines: [], hasMore: false }
  const { lines, hasMore } = history
  const groups = lines.reduce<{ key: string; title: string; lines: Line[] }[]>((days, line) => { const key = localDayKey(line.at); const current = days.at(-1); if (current?.key === key) current.lines.push(line); else days.push({ key, title: dayHeading(line.at), lines: [line] }); return days }, [])
  const changeFilter = (value: HistoryFilter) => { setSearch(value === 'all' ? {} : { tipo: value }); setShown(20) }
  return <Layout>{location.state?.success && <p role="status">{location.state.success}</p>}<h1>Histórico</h1><div className="history-filters" role="group" aria-label="Filtrar histórico">{historyFilters.map(item => <button key={item.value} type="button" className={filter === item.value ? 'secondary active' : 'secondary'} onClick={() => changeFilter(item.value)}>{item.label}</button>)}</div>{lines.length ? <><div className="timeline">{groups.map(group => <section className="history-day" key={group.key}><h2>{group.title}</h2>{group.lines.map(line => <div className="item" key={`${line.table}-${line.id}`}><Link className="history-link" to={`/detalhes/${line.table}/${line.recordId}`}><b>{time(line.at)} · {line.title}</b>{line.detail && <span className="muted">{line.detail}</span>}</Link></div>)}</section>)}</div>{hasMore && <button className="secondary history-more" type="button" onClick={() => setShown(value => value + 20)}>Carregar registros anteriores</button>}</> : <section className="card"><p>Nenhum registro neste filtro.</p></section>}</Layout>
}

function GlucoseChart({ points, compact = false }: { points: { id?: string; at: string; value: number; context?: string }[]; compact?: boolean }) {
  const chartRef = React.useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const ordered = [...points].sort((first, second) => +new Date(first.at) - +new Date(second.at))
  const width = 320; const height = compact ? 120 : 200; const inset = compact ? { top: 10, right: 10, bottom: 18, left: 10 } : { top: 12, right: 12, bottom: 42, left: 42 }
  const plotWidth = width - inset.left - inset.right; const plotHeight = height - inset.top - inset.bottom
  const values = ordered.map(point => point.value); const lowest = Math.min(...values); const highest = Math.max(...values)
  const spread = Math.max(highest - lowest, 20); const minimum = Math.max(0, lowest - Math.max(10, spread * .15)); const maximum = highest + Math.max(10, spread * .15)
  const x = (index: number) => ordered.length === 1 ? inset.left + plotWidth / 2 : inset.left + index * plotWidth / (ordered.length - 1)
  const y = (value: number) => inset.top + (maximum - value) * plotHeight / (maximum - minimum)
  const path = ordered.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  const formatDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const tooltipDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace(', ', ' às ')
  const pointId = (point: { id?: string; at: string; value: number }) => point.id ?? `${point.at}-${point.value}`
  const selected = ordered.find(point => pointId(point) === selectedId)
  const selectedIndex = selected ? ordered.indexOf(selected) : -1
  const selectionKeys = ordered.map(pointId).join('|')
  useEffect(() => { if (selectedId && !ordered.some(point => pointId(point) === selectedId)) setSelectedId(undefined) }, [selectedId, selectionKeys])
  useEffect(() => {
    const closeWhenOutside = (event: PointerEvent) => { if (!chartRef.current?.contains(event.target as Node)) setSelectedId(undefined) }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(undefined) }
    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeWhenOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [])
  const ticks = [maximum, (maximum + minimum) / 2, minimum]
  const selectedX = selected ? x(selectedIndex) / width * 100 : 0
  const selectedY = selected ? y(selected.value) / height * 100 : 0
  const tooltipStyle = { left: `${Math.min(64, Math.max(36, selectedX))}%`, top: `${selectedY}%` }
  return <div ref={chartRef} className={compact ? 'glucose-chart compact' : 'glucose-chart'}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Gráfico de glicemia com ${ordered.length} ${ordered.length === 1 ? 'medição' : 'medições'}`} onClick={() => setSelectedId(undefined)}><title>Gráfico de glicemia</title>{!compact && ticks.map(value => <g key={value}><line className="glucose-chart-grid" x1={inset.left} x2={width - inset.right} y1={y(value)} y2={y(value)} /><text className="glucose-chart-axis" x={inset.left - 6} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}<polyline className="glucose-chart-line" points={path} />{ordered.map((point, index) => { const id = pointId(point); const isSelected = id === selectedId; const label = `Ver detalhes da medição de ${point.value} mg/dL em ${tooltipDateTime(point.at)}`; return <g key={id}><circle className={isSelected ? 'glucose-chart-point selected' : 'glucose-chart-point'} cx={x(index)} cy={y(point.value)} r={isSelected ? 6 : 4} fill={classifyGlucose(point.value).color}><title>{`${point.value} mg/dL · ${formatDateTime(point.at)}`}</title></circle><circle className="glucose-chart-hit-area" cx={x(index)} cy={y(point.value)} r="14" role="button" tabIndex={0} aria-label={label} aria-pressed={isSelected} aria-describedby={isSelected ? 'glucose-chart-tooltip' : undefined} onClick={event => { event.stopPropagation(); setSelectedId(id) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(id) } }} /></g> })}</svg>{selected && <div id="glucose-chart-tooltip" role="tooltip" className={selectedY < 35 ? 'glucose-chart-tooltip below' : 'glucose-chart-tooltip'} style={tooltipStyle}><strong>{selected.value} mg/dL</strong><span>{tooltipDateTime(selected.at)}</span>{selected.context && selected.context !== 'Não informado' && <span>{selected.context}</span>}</div>}</div>
}

function Report() {
  const location = useLocation(); const [search, setSearch] = useSearchParams(); const selectedPeriod = Number(search.get('period')); const [period, setPeriod] = useState([7, 30, 90].includes(selectedPeriod) ? selectedPeriod : 30)
  const data = useLiveQuery(async () => {
    const since = Date.now() - period * 86400000
    const [g, m, i, w, e] = await Promise.all([db.glucose.toArray(), db.meals.toArray(), db.insulin.toArray(), db.workouts.toArray(), db.episodes.toArray()])
    return { g: g.filter(x => +new Date(x.at) >= since), m: m.filter(x => +new Date(x.at) >= since), i: i.filter(x => +new Date(x.at) >= since), w: w.filter(x => +new Date(x.startedAt) >= since), e: e.filter(x => +new Date(x.startedAt) >= since) }
  }, [period])
  const values = data?.g.map(x => x.value) ?? []; const summary = glucoseSummary(values)
  const reportGlucoseSummary = [
    { title: 'Medições', value: values.length },
    { title: 'Mínima', value: summary === undefined ? '—' : `${summary.minimum} mg/dL` },
    { title: 'Máxima', value: summary === undefined ? '—' : `${summary.maximum} mg/dL` },
    { title: 'Média aritmética simples', value: summary === undefined ? '—' : `${summary.average.toFixed(0)} mg/dL` },
  ]
  const eventCards = [[Soup, 'Refeições', data?.m.length ?? 0], [Syringe, 'Aplicações de insulina', data?.i.length ?? 0], [Dumbbell, 'Treinos', data?.w.length ?? 0], [TriangleAlert, 'Episódios', data?.e.length ?? 0]] as const
  useEffect(() => { try { sessionStorage.setItem('glicoponto-report-period', String(period)) } catch { /* A navegação continua disponível sem armazenamento da preferência. */ } }, [period])
  useEffect(() => { if (location.hash !== '#grafico-glicemia' || data === undefined) return; const frame = window.requestAnimationFrame(() => document.getElementById('grafico-glicemia')?.scrollIntoView?.({ block: 'start' })); return () => window.cancelAnimationFrame(frame) }, [data, location.hash])
  const changePeriod = (value: number) => { setPeriod(value); setSearch({ period: String(value) }, { replace: true }) }
  return <Layout><h1>Relatório</h1><label className="label">Período<select className="field" value={period} onChange={e => changePeriod(Number(e.target.value))}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><section className="report-section" id="grafico-glicemia" tabIndex={-1}><h2>Glicemia</h2><dl className="glucose-summary">{reportGlucoseSummary.map(({ title, value }) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>{values.length ? <><GlucoseChart points={data?.g ?? []} /><GlucoseLegend /><p className="muted">A média considera somente as medições cadastradas e não representa monitoramento contínuo.</p></> : <div className="glucose-chart-empty"><p className="muted">Nenhuma medição cadastrada neste período.</p></div>}</section><section className="report-section"><h2>Acontecimentos registrados</h2><div className="report-cards">{eventCards.map(([Icon, title, value]) => <section className="card" key={title}><span className="report-label"><Icon size={16} aria-hidden="true" /> {title}</span><h3>{value}</h3></section>)}</div><p className="muted">As contagens representam somente os registros cadastrados no período.</p></section></Layout>
}

function GlucoseLegend() {
  const ranges = [
    ['Menor que 54 mg/dL', 'Hipoglicemia nível 2', 53], ['54–69 mg/dL', 'Hipoglicemia nível 1', 54], ['70–79 mg/dL', 'Abaixo da faixa definida', 70], ['80–130 mg/dL', 'Dentro da faixa definida', 80], ['131–170 mg/dL', 'Intermediária', 131], ['171–299 mg/dL', 'Atenção', 171], ['300 ou mais', 'Atenção alta', 300],
  ] as const
  return <aside className="glucose-legend" aria-label="Legenda de classificação da glicemia"><p>As cores identificam o valor de cada ponto, não a linha de conexão.</p><ul>{ranges.map(([range, label, value]) => <li key={range}><span className="glucose-legend-swatch" style={{ backgroundColor: classifyGlucose(value).color }} aria-hidden="true" /><span>{range}: {label}</span></li>)}</ul><p>As faixas visuais são provisórias e não substituem metas individualizadas, que podem variar conforme o contexto da medição.</p></aside>
}

function BackupActions({ onRestored }: { onRestored?: () => void }) {
  const [preview, setPreview] = useState<ImportPreview>(); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [profileStrategy, setProfileStrategy] = useState<ProfileStrategy>('keep'); const [busy, setBusy] = useState(false)
  const download = async () => { const backup = await exportBackup(); const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'glicemio-backup.json'; link.click(); URL.revokeObjectURL(url) }
  const select = async (file?: File) => { setPreview(undefined); setMessage(''); setError(''); if (!file) return; if (file.size > 10 * 1024 * 1024) { setError('Selecione um arquivo JSON de até 10 MB.'); return } try { setPreview(await previewBackup(await file.text())) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível validar o backup.') } }
  const restore = async () => { if (!preview || preview.relationshipErrors.length) return; setBusy(true); setError(''); try { const result = await restoreBackup(preview, profileStrategy); const total = Object.values(result).reduce((sum, value) => sum + value, 0); setMessage(`${total} registro(s) restaurado(s) neste dispositivo.`); setPreview(undefined); onRestored?.() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o backup.') } finally { setBusy(false) } }
  return <section className="backup-actions"><div className="actions"><Button type="button" onClick={() => void download()}>Exportar JSON</Button><label className="secondary backup-file">Importar JSON<input type="file" accept="application/json,.json" onChange={event => void select(event.target.files?.[0])} /></label></div>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{preview && <div className="backup-preview"><p><b>Prévia do backup {preview.sourceVersion === 'legacy' ? 'legado' : 'versão 1'}</b></p><ul>{Object.entries(preview.additions).map(([table, count]) => <li key={table}>{table}: {count} novo(s), {preview.duplicates[table as keyof typeof preview.duplicates]} duplicado(s), {preview.conflicts[table as keyof typeof preview.conflicts]} conflito(s)</li>)}</ul>{preview.relationshipErrors.length > 0 ? <><p role="alert">Há referências inválidas. Corrija o arquivo antes de restaurar.</p><ul>{preview.relationshipErrors.map(item => <li key={item}>{item}</li>)}</ul></> : <>{preview.profileConflict && <label className="label">Perfil existente<select className="field" value={profileStrategy} onChange={event => setProfileStrategy(event.target.value as ProfileStrategy)}><option value="keep">Manter o perfil atual</option><option value="restore">Restaurar o perfil do backup</option></select></label>}<div className="actions"><Button type="button" disabled={busy} onClick={() => void restore()}>{busy ? 'Restaurando…' : 'Confirmar restauração'}</Button><button className="secondary" type="button" disabled={busy} onClick={() => setPreview(undefined)}>Cancelar</button></div></>}</div>}</section>
}

function More() {
  const profile = useLiveQuery(() => db.profiles.get('local'), []); const nav = useNavigate()
  const [code, setCode] = useState<string>(); const [typed, setTyped] = useState(''); const [deleting, setDeleting] = useState(false)
  const beginDelete = () => { const values = new Uint32Array(1); crypto.getRandomValues(values); setCode(String(values[0] % 1000000).padStart(6, '0')); setTyped('') }
  const clear = async () => { if (!code || typed !== code) return; setDeleting(true); await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(table => table.clear()))); nav('/onboarding') }
  return <Layout><h1>Ajustes</h1><div className="more-sections"><section className="card more-card"><div className="home-card-heading"><h2>Perfil</h2></div>{profile && <ProfileForm key={profile.id} profile={profile} />}</section><section className="card more-card"><div className="home-card-heading"><h2>Dados e backup</h2></div><BackupActions /><MealTimeReferenceReview />{!code ? <button className="danger" onClick={beginDelete}>Excluir dados locais</button> : <div className="delete-confirm"><p>Esta ação eliminará os registros locais deste dispositivo. Exporte um JSON antes de continuar.</p><p>Digite o código <b>{code}</b> para confirmar.</p><input className="field" inputMode="numeric" maxLength={6} value={typed} onChange={event => setTyped(event.target.value.replace(/\D/g, ''))} aria-label="Código de confirmação" /><div className="actions"><button className="danger" disabled={typed !== code || deleting} onClick={() => void clear()}>{deleting ? 'Excluindo…' : 'Confirmar exclusão'}</button><button className="secondary" disabled={deleting} onClick={() => setCode(undefined)}>Cancelar</button></div></div>}</section></div></Layout>
}

function ScrollManager() {
  const location = useLocation()
  useEffect(() => {
    if (location.hash) return
    const frame = window.requestAnimationFrame(scrollToTop)
    return () => window.cancelAnimationFrame(frame)
  }, [location.key, location.pathname, location.search, location.hash])
  return null
}

function AppRoutes() { return <Routes><Route path="/onboarding" element={<Onboarding />} /><Route path="/" element={<Home />} /><Route path="/glicemia" element={<RecordForm kind="glicemia" />} /><Route path="/glicemia/:id/editar" element={<RecordForm kind="glicemia" />} /><Route path="/refeicao" element={<RecordForm kind="refeicao" />} /><Route path="/refeicao/:id/editar" element={<RecordForm kind="refeicao" />} /><Route path="/insulina" element={<RecordForm kind="insulina" />} /><Route path="/insulina/:id/editar" element={<RecordForm kind="insulina" />} /><Route path="/treino" element={<RecordForm kind="treino" />} /><Route path="/treino/:id/editar" element={<RecordForm kind="treino" />} /><Route path="/consulta" element={<RecordForm kind="consulta" />} /><Route path="/consulta/:id/editar" element={<RecordForm kind="consulta" />} /><Route path="/episodio" element={<Episode />} /><Route path="/episodio/:id/editar" element={<Episode />} /><Route path="/detalhes/:table/:id" element={<Details />} /><Route path="/historico" element={<History />} /><Route path="/relatorio" element={<Report />} /><Route path="/mais" element={<More />} /><Route path="*" element={<Navigate to="/" />} /></Routes> }
class StorageBoundary extends React.Component<{ children: ReactNode }, { error: boolean }> { state = { error: false }; static getDerivedStateFromError() { return { error: true } }; componentDidCatch(error: Error) { console.error('Falha ao acessar registros locais', error) }; render() { return this.state.error ? <main className="shell"><section className="card"><h1>Não foi possível abrir os registros</h1><p role="alert">O armazenamento local está indisponível. Nenhum dado foi apagado.</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></section></main> : this.props.children } }
export function App() { return <StorageBoundary><ScrollManager /><AppRoutes /></StorageBoundary> }
