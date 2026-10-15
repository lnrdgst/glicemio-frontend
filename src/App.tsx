import * as React from 'react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Droplets, Dumbbell, Soup, Syringe, TriangleAlert } from 'lucide-react'
import { db, now, stamp, type Meal } from './database/db'
import { exportBackup, previewBackup, restoreBackup, type ImportPreview, type ProfileStrategy } from './database/backup'
import { RecordForm, type RecordKind } from './RecordForm'
import { ProfileForm } from './ProfileForm'
import { insulinName } from './shared/records'
import { classifyGlucose, hypoglycemiaGuidance } from './shared/glucose'
import { shouldShowBasalReminder } from './shared/basalReminder'
import { Button, Layout, usePersistence } from './shared/ui'
import { dateTime, dayHeading, duration, eventDateTime, localDayKey, time } from './shared/format'

const symptoms = ['Tremor', 'Suor', 'Fraqueza', 'Tontura', 'Palpitação', 'Confusão', 'Outro']
const detailsFor: Record<string, { title: string; edit: string }> = {
  glucose: { title: 'Glicemia', edit: 'glicemia' }, meals: { title: 'Refeição', edit: 'refeicao' },
  insulin: { title: 'Aplicação de insulina', edit: 'insulina' }, workouts: { title: 'Treino', edit: 'treino' },
  appointments: { title: 'Consulta', edit: 'consulta' }, episodes: { title: 'Episódio de sintomas', edit: 'episodio' },
}

function Delete({ run }: { run: () => Promise<void> }) {
  const { run: persist, saving, error } = usePersistence()
  return <span><button className="danger" disabled={saving} onClick={() => { if (confirm('Excluir este registro?')) void persist(run) }}>Excluir</button>{error && <span role="alert">Não foi possível excluir o registro. Tente novamente.</span>}</span>
}

function Onboarding() {
  const nav = useNavigate()
  return <main className="shell onboarding"><section className="card"><span style={{ color: '#d7865b' }}>GLICOPONTO</span><h1>Vamos começar pelo essencial.</h1><p className="muted">Seus registros ficam neste dispositivo durante esta versão de desenvolvimento.</p><ProfileForm onSaved={() => nav('/', { replace: true })} /><BackupActions onRestored={() => nav('/', { replace: true })} /></section></main>
}

function useProfile() { return useLiveQuery(() => db.profiles.get('local').then(value => value ?? null), []) }

function Home() {
  const location = useLocation(); const profile = useProfile()
  const glucose = useLiveQuery(() => db.glucose.orderBy('at').last(), [])
  const recentGlucose = useLiveQuery(() => db.glucose.filter(item => new Date(item.at).getTime() >= Date.now() - 7 * 86400000).toArray(), []) ?? []
  const meals = useLiveQuery(() => db.meals.orderBy('at').reverse().limit(3).toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.orderBy('startedAt').reverse().limit(3).toArray(), []) ?? []
  const appointment = useLiveQuery(() => db.appointments.filter(x => new Date(x.at) > new Date()).sortBy('at'), [])?.[0]
  const insulin = useLiveQuery(() => db.insulin.orderBy('at').reverse().toArray(), []) ?? []
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => { const update = () => setClock(new Date()); const timer = window.setInterval(update, 60000); document.addEventListener('visibilitychange', update); return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update) } }, [])
  const glucoseState = glucose ? classifyGlucose(glucose.value) : undefined; const glucoseGuidance = glucoseState ? hypoglycemiaGuidance(glucoseState) : undefined
  if (profile === undefined) return <main className="shell" />
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Layout>{location.state?.success && <p role="status">{location.state.success}</p>}<header><span style={{ color: '#d7865b', fontWeight: 800, letterSpacing: 2 }}>GLICOPONTO</span><h1 style={{ marginBottom: 4 }}>Olá, {profile.name}</h1>{profile.diagnosis && <p className="muted">{profile.diagnosis}</p>}</header>
    {glucose && glucoseState ? <section className="home-record card glucose-card" style={{ '--glucose-status-color': glucoseState.color } as React.CSSProperties}><div className="row"><span className="muted">Última medição</span><Link to="/historico?tipo=glucose">Ver histórico</Link></div><Link className="home-glucose-detail" to={`/detalhes/glucose/${glucose.id}`}><h2 style={{ fontSize: '2.3rem', margin: '6px 0' }}>{glucose.value} <small>mg/dL</small></h2><p className="glucose-status">{glucoseState.label}</p><p className="muted">{glucose.context || 'Sem contexto'} · registrada {eventDateTime(glucose.at)}</p></Link>{recentGlucose.length > 0 && <><p className="home-chart-title">Evolução recente</p><GlucoseChart points={recentGlucose} compact /></>}{glucose.mealId && <p className="muted">Associada a uma refeição</p>}{glucoseGuidance && <p className="glucose-guidance">{glucoseGuidance}</p>}</section> : <section className="card" style={{ margin: '22px 0' }}><h2>Nenhuma medição ainda</h2><p className="muted">Registre seu primeiro Ponto para acompanhar seu contexto.</p></section>}
    <div className="quick"><Link to="/glicemia" className="quick-glucose"><Droplets size={22} /><br />Registrar glicemia</Link><Link to="/refeicao" className="quick-meal"><Soup size={22} /><br />Registrar refeição</Link><Link to="/insulina" className="quick-insulin"><Syringe size={22} /><br />Registrar insulina</Link><Link to="/treino" className="quick-workout"><Dumbbell size={22} /><br />Registrar treino</Link><Link to="/episodio" className="symptoms quick-symptoms"><TriangleAlert size={22} /><br />Estou com sintomas</Link></div>
    {appointment && <Link className="card home-record" to={`/detalhes/appointments/${appointment.id}`}><b>Próxima consulta</b><p>{eventDateTime(appointment.at)}</p><p className="muted">{appointment.professional || 'Profissional não informado'} · em {Math.ceil((new Date(appointment.at).getTime() - Date.now()) / 86400000)} dias</p></Link>}
    <InsulinSummary />
    <BasalReminder profile={profile} insulin={insulin} now={clock} />
    <HomeList title="Últimas refeições" empty="Nenhuma refeição registrada." items={meals} render={(record: Meal) => <><span>{record.kind}</span><span className="muted">{eventDateTime(record.at)}</span></>} table="meals" filter="meals" />
    <HomeList title="Últimos treinos" empty="Nenhum treino registrado." items={workouts} render={record => <><span>{record.activity}</span><span className="muted">{duration(record.startedAt, record.endedAt)}</span></>} table="workouts" filter="workouts" />
  </Layout>
}

function BasalReminder({ profile, insulin, now: current }: { profile: any; insulin: any[]; now: Date }) {
  const nav = useNavigate(); const basal = insulin.filter(item => item.kind === 'Basal/lenta'); const last = basal[0]; const today = current.toLocaleDateString('en-CA'); const key = 'glicoponto-basal-reminder'
  const [, refresh] = useState(0)
  const state = (() => { try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} } })(); const show = shouldShowBasalReminder({ enabled: profile.basalReminderEnabled, time: profile.basalReminderTime, now: current, lastBasalAt: last?.at, basalToday: basal.some(item => new Date(item.at).toLocaleDateString('en-CA') === today), laterUntil: state.laterUntil, ignoredDay: state.ignoredDay })
  if (!show) return null
  const save = (value: object) => { localStorage.setItem(key, JSON.stringify(value)); refresh(value => value + 1) }
  return <section className="card basal-reminder"><b>Insulina basal — lembrete</b><p>Ainda não há registro da sua insulina basal para hoje. Deseja registrar agora?</p>{last && <p className="muted">Último registro: {eventDateTime(last.at)}.</p>}<p className="muted">A ausência de registro não confirma ausência de aplicação.</p><div className="actions"><button className="primary" onClick={() => nav('/insulina')}>Registrar agora</button><button className="secondary" onClick={() => save({ laterUntil: Date.now() + 15 * 60000 })}>Lembrar mais tarde</button><button className="secondary" onClick={() => save({ ignoredDay: today })}>Ignorar hoje</button></div></section>
}

function InsulinSummary() {
  const applications = useLiveQuery(() => db.insulin.orderBy('at').reverse().toArray(), []) ?? []
  const basal = applications.find(x => x.kind === 'Basal/lenta'); const rapid = applications.find(x => x.kind === 'Rápida')
  if (!basal && !rapid) return <section className="card insulin-summary"><h2>Últimas aplicações de insulina</h2><p className="muted">Nenhuma aplicação registrada.</p></section>
  const line = (label: string, application: typeof basal, divider = false) => application && <Link className="insulin-line" style={{ borderTop: divider ? '1px solid #39322e' : undefined }} to={`/detalhes/insulin/${application.id}`}><div><b>{label}</b>{insulinName(application) && <p>{insulinName(application)}</p>}<p className="muted">{eventDateTime(application.at)}</p></div><strong>{application.dose.toLocaleString('pt-BR')} UI</strong></Link>
  return <section className="card insulin-summary"><div className="row"><h2>Últimas aplicações de insulina</h2>{basal && rapid ? <span className="insulin-history-links"><Link to="/historico?tipo=insulin&subtipo=basal">Basal</Link><Link to="/historico?tipo=insulin&subtipo=rapida">Rápida</Link></span> : <Link to={basal ? '/historico?tipo=insulin&subtipo=basal' : '/historico?tipo=insulin&subtipo=rapida'}>Ver histórico</Link>}</div>{line('Basal / lenta', basal)}{line('Rápida', rapid, Boolean(basal))}</section>
}

function HomeList({ title, empty, items, render, table, filter }: { title: string; empty: string; items: any[]; render: (item: any) => React.ReactNode; table: string; filter: string }) {
  return <section style={{ marginTop: 22 }}><div className="row"><h2 style={{ fontSize: '1.1rem' }}>{title}</h2><Link to={`/historico?tipo=${filter}`} style={{ color: '#d7865b' }}>Ver histórico</Link></div><div className="card">{items.length ? items.map(item => <Link className="home-list-item row" key={item.id} to={`/detalhes/${table}/${item.id}`}>{render(item)}</Link>) : <p className="muted">{empty}</p>}</div></section>
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
  return <Layout><Link to={editing ? `/detalhes/episodes/${id}` : '/'} className="muted">← Voltar</Link><h1>{editing ? 'Editar episódio de sintomas' : current ? 'Acompanhando sintomas' : 'Registrar sintomas'}</h1><form onSubmit={save} className="card"><fieldset disabled={saving}><b>Selecione os sintomas</b><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>{symptoms.map(symptom => <label key={symptom} className="secondary" style={{ padding: 8 }}><input type="checkbox" checked={selected.includes(symptom)} onChange={event => setSelected(value => event.target.checked ? [...value, symptom] : value.filter(x => x !== symptom))} /> {symptom}</label>)}</div><label className="label">Observações<textarea className="field" name="note" defaultValue={current?.note} /></label><div className="actions"><Button type="submit">{editing ? 'Salvar alterações' : 'Salvar'}</Button>{current && !editing && <><Link className="secondary" to={`/glicemia?episode=${current.id}`}>Registrar glicemia</Link><button type="button" className="secondary" onClick={end}>Encerrar episódio</button></>}</div></fieldset>{error && <p role="alert">{error}</p>}</form></Layout>
}

function Details() {
  const { table = '', id = '' } = useParams(); const config = detailsFor[table]; const record = useLiveQuery(() => config ? db.table(table).get(id) : Promise.resolve(undefined), [table, id, config]) as any
  if (!config) return <Navigate to="/historico" replace />
  if (record === undefined) return <Layout><h1>Carregando registro…</h1></Layout>
  if (!record) return <Layout><Link to="/" className="muted">← Início</Link><section className="card"><h1>Registro não encontrado</h1></section></Layout>
  const at = record.at || record.startedAt
  const detail = table === 'glucose' ? `${record.value} mg/dL · ${record.context || 'Sem contexto'}` : table === 'insulin' ? `${insulinName(record) || record.kind} · ${record.dose.toLocaleString('pt-BR')} UI` : table === 'meals' ? record.kind : table === 'workouts' ? `${record.activity} · ${duration(record.startedAt, record.endedAt)}` : table === 'episodes' ? record.symptoms.join(', ') || 'Sem sintomas selecionados' : record.professional || 'Profissional não informado'
  return <Layout><Link to="/" className="muted">← Início</Link><section className="card details"><span className="muted">{config.title}</span><h1>{detail}</h1><p>{eventDateTime(at)}</p>{record.note && <p className="muted">{record.note}</p>}{record.description && <p className="muted">{record.description}</p>}<div className="actions"><Link className="primary" to={config.edit === 'episodio' ? `/episodio/${id}/editar` : `/${config.edit}/${id}/editar`}>Editar</Link><Delete run={() => db.table(table).delete(id)} /></div></section></Layout>
}

type HistoryFilter = 'all' | 'glucose' | 'meals' | 'insulin' | 'workouts' | 'episodes' | 'appointments'
type Line = { id: string; at: string; title: string; detail?: string; table: string; recordId: string }
const historyFilters: { value: HistoryFilter; label: string }[] = [{ value: 'all', label: 'Todos' }, { value: 'glucose', label: 'Glicemias' }, { value: 'meals', label: 'Refeições' }, { value: 'insulin', label: 'Insulinas' }, { value: 'workouts', label: 'Treinos' }, { value: 'episodes', label: 'Episódios' }, { value: 'appointments', label: 'Consultas' }]
const sortLines = (lines: Line[]) => lines.sort((a, b) => +new Date(b.at) - +new Date(a.at) || a.table.localeCompare(b.table) || a.id.localeCompare(b.id))

function History() {
  const [search, setSearch] = useSearchParams(); const requested = historyFilters.some(item => item.value === search.get('tipo')) ? search.get('tipo') as HistoryFilter : 'all'; const [filter, setFilter] = useState<HistoryFilter>(requested); const [shown, setShown] = useState(20); const subtype = search.get('subtipo')
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
    const ordered = sortLines([...glucose.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `${x.value} mg/dL`, detail: x.context, table: 'glucose' })), ...meals.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: x.kind, detail: x.description, table: 'meals' })), ...insulin.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `Insulina ${x.kind}`, detail: `${insulinName(x) ? `${insulinName(x)} · ` : ''}${x.dose.toLocaleString('pt-BR')} UI`, table: 'insulin' })), ...workouts.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Treino', detail: x.activity, table: 'workouts' })), ...episodes.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Episódio', detail: x.symptoms.join(', '), table: 'episodes' })), ...appointments.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: 'Consulta', detail: x.professional, table: 'appointments' }))])
    return { lines: ordered.slice(0, shown), hasMore: ordered.length > shown }
  }, [filter, shown, subtype]) ?? { lines: [], hasMore: false }
  const { lines, hasMore } = history
  const groups = lines.reduce<{ key: string; title: string; lines: Line[] }[]>((days, line) => { const key = localDayKey(line.at); const current = days.at(-1); if (current?.key === key) current.lines.push(line); else days.push({ key, title: dayHeading(line.at), lines: [line] }); return days }, [])
  const changeFilter = (value: HistoryFilter) => { setSearch(value === 'all' ? {} : { tipo: value }); setShown(20) }
  return <Layout><h1>Histórico</h1><div className="history-filters" role="group" aria-label="Filtrar histórico">{historyFilters.map(item => <button key={item.value} type="button" className={filter === item.value ? 'secondary active' : 'secondary'} onClick={() => changeFilter(item.value)}>{item.label}</button>)}</div>{lines.length ? <><div className="timeline">{groups.map(group => <section className="history-day" key={group.key}><h2>{group.title}</h2>{group.lines.map(line => <div className="item" key={`${line.table}-${line.id}`}><Link className="history-link" to={`/detalhes/${line.table}/${line.recordId}`}><b>{time(line.at)} · {line.title}</b>{line.detail && <span className="muted">{line.detail}</span>}</Link></div>)}</section>)}</div>{hasMore && <button className="secondary history-more" type="button" onClick={() => setShown(value => value + 20)}>Carregar registros anteriores</button>}</> : <section className="card"><p>Nenhum registro neste filtro.</p></section>}</Layout>
}

function GlucoseChart({ points, compact = false }: { points: { id?: string; at: string; value: number }[]; compact?: boolean }) {
  const ordered = [...points].sort((first, second) => +new Date(first.at) - +new Date(second.at))
  const width = 320; const height = compact ? 120 : 200; const inset = compact ? { top: 10, right: 10, bottom: 18, left: 10 } : { top: 12, right: 12, bottom: 42, left: 42 }
  const plotWidth = width - inset.left - inset.right; const plotHeight = height - inset.top - inset.bottom
  const values = ordered.map(point => point.value); const lowest = Math.min(...values); const highest = Math.max(...values)
  const spread = Math.max(highest - lowest, 20); const minimum = Math.max(0, lowest - Math.max(10, spread * .15)); const maximum = highest + Math.max(10, spread * .15)
  const x = (index: number) => ordered.length === 1 ? inset.left + plotWidth / 2 : inset.left + index * plotWidth / (ordered.length - 1)
  const y = (value: number) => inset.top + (maximum - value) * plotHeight / (maximum - minimum)
  const path = ordered.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  const formatDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const ticks = [maximum, (maximum + minimum) / 2, minimum]
  return <div className={compact ? 'glucose-chart compact' : 'glucose-chart'}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Gráfico de glicemia com ${ordered.length} medições`}><title>Gráfico de glicemia</title>{!compact && ticks.map(value => <g key={value}><line className="glucose-chart-grid" x1={inset.left} x2={width - inset.right} y1={y(value)} y2={y(value)} /><text className="glucose-chart-axis" x={inset.left - 6} y={y(value) + 4} textAnchor="end">{Math.round(value)}</text></g>)}<polyline className="glucose-chart-line" points={path} />{ordered.map((point, index) => <circle className="glucose-chart-point" key={point.id ?? `${point.at}-${point.value}`} cx={x(index)} cy={y(point.value)} r="4" fill={classifyGlucose(point.value).color}><title>{`${point.value} mg/dL · ${formatDateTime(point.at)}`}</title></circle>)}</svg></div>
}

function Report() {
  const [period, setPeriod] = useState(30)
  const data = useLiveQuery(async () => {
    const since = Date.now() - period * 86400000
    const [g, m, i, w, e] = await Promise.all([db.glucose.toArray(), db.meals.toArray(), db.insulin.toArray(), db.workouts.toArray(), db.episodes.toArray()])
    return { g: g.filter(x => +new Date(x.at) >= since), m: m.filter(x => +new Date(x.at) >= since), i: i.filter(x => +new Date(x.at) >= since), w: w.filter(x => +new Date(x.startedAt) >= since), e: e.filter(x => +new Date(x.startedAt) >= since) }
  }, [period])
  const values = data?.g.map(x => x.value) ?? []
  const minimum = values.length ? Math.min(...values) : undefined
  const maximum = values.length ? Math.max(...values) : undefined
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
  const glucoseSummary = [
    { title: 'Medições', value: values.length },
    { title: 'Mínima', value: minimum === undefined ? '—' : `${minimum} mg/dL` },
    { title: 'Máxima', value: maximum === undefined ? '—' : `${maximum} mg/dL` },
    { title: 'Média aritmética simples', value: average === undefined ? '—' : `${average.toFixed(0)} mg/dL` },
  ]
  const eventCards = [[Soup, 'Refeições', data?.m.length ?? 0], [Syringe, 'Aplicações de insulina', data?.i.length ?? 0], [Dumbbell, 'Treinos', data?.w.length ?? 0], [TriangleAlert, 'Episódios', data?.e.length ?? 0]] as const
  return <Layout><h1>Relatório</h1><label className="label">Período<select className="field" value={period} onChange={e => setPeriod(Number(e.target.value))}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><section className="report-section"><h2>Glicemia</h2><dl className="glucose-summary">{glucoseSummary.map(({ title, value }) => <div key={title}><dt>{title}</dt><dd>{value}</dd></div>)}</dl>{values.length ? <><GlucoseChart points={data?.g ?? []} /><p className="muted">A média considera somente as medições cadastradas e não representa monitoramento contínuo.</p></> : <div className="glucose-chart-empty"><p className="muted">Nenhuma medição cadastrada neste período.</p></div>}</section><section className="report-section"><h2>Acontecimentos registrados</h2><div className="report-cards">{eventCards.map(([Icon, title, value]) => <section className="card" key={title}><span className="report-label"><Icon size={16} aria-hidden="true" /> {title}</span><h3>{value}</h3></section>)}</div><p className="muted">As contagens representam somente os registros cadastrados no período.</p></section></Layout>
}

function BackupActions({ onRestored }: { onRestored?: () => void }) {
  const [preview, setPreview] = useState<ImportPreview>(); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [profileStrategy, setProfileStrategy] = useState<ProfileStrategy>('keep'); const [busy, setBusy] = useState(false)
  const download = async () => { const backup = await exportBackup(); const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'glicoponto-backup.json'; link.click(); URL.revokeObjectURL(url) }
  const select = async (file?: File) => { setPreview(undefined); setMessage(''); setError(''); if (!file) return; if (file.size > 10 * 1024 * 1024) { setError('Selecione um arquivo JSON de até 10 MB.'); return } try { setPreview(await previewBackup(await file.text())) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível validar o backup.') } }
  const restore = async () => { if (!preview || preview.relationshipErrors.length) return; setBusy(true); setError(''); try { const result = await restoreBackup(preview, profileStrategy); const total = Object.values(result).reduce((sum, value) => sum + value, 0); setMessage(`${total} registro(s) restaurado(s) neste dispositivo.`); setPreview(undefined); onRestored?.() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível restaurar o backup.') } finally { setBusy(false) } }
  return <section className="backup-actions"><div className="actions"><Button type="button" onClick={() => void download()}>Exportar JSON</Button><label className="secondary backup-file">Importar JSON<input type="file" accept="application/json,.json" onChange={event => void select(event.target.files?.[0])} /></label></div>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{preview && <div className="backup-preview"><p><b>Prévia do backup {preview.sourceVersion === 'legacy' ? 'legado' : 'versão 1'}</b></p><ul>{Object.entries(preview.additions).map(([table, count]) => <li key={table}>{table}: {count} novo(s), {preview.duplicates[table as keyof typeof preview.duplicates]} duplicado(s), {preview.conflicts[table as keyof typeof preview.conflicts]} conflito(s)</li>)}</ul>{preview.relationshipErrors.length > 0 ? <><p role="alert">Há referências inválidas. Corrija o arquivo antes de restaurar.</p><ul>{preview.relationshipErrors.map(item => <li key={item}>{item}</li>)}</ul></> : <>{preview.profileConflict && <label className="label">Perfil existente<select className="field" value={profileStrategy} onChange={event => setProfileStrategy(event.target.value as ProfileStrategy)}><option value="keep">Manter o perfil atual</option><option value="restore">Restaurar o perfil do backup</option></select></label>}<div className="actions"><Button type="button" disabled={busy} onClick={() => void restore()}>{busy ? 'Restaurando…' : 'Confirmar restauração'}</Button><button className="secondary" type="button" disabled={busy} onClick={() => setPreview(undefined)}>Cancelar</button></div></>}</div>}</section>
}

function More() {
  const profile = useLiveQuery(() => db.profiles.get('local'), []); const nav = useNavigate()
  const appointment = useLiveQuery(() => db.appointments.filter(item => new Date(item.at) > new Date()).sortBy('at'), [])?.[0]
  const [code, setCode] = useState<string>(); const [typed, setTyped] = useState(''); const [deleting, setDeleting] = useState(false)
  const beginDelete = () => { const values = new Uint32Array(1); crypto.getRandomValues(values); setCode(String(values[0] % 1000000).padStart(6, '0')); setTyped('') }
  const clear = async () => { if (!code || typed !== code) return; setDeleting(true); await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(table => table.clear()))); nav('/onboarding') }
  return <Layout><h1>Mais</h1><div className="more-sections"><section className="card more-card"><h2>Perfil</h2>{profile && <ProfileForm key={profile.id} profile={profile} />}</section><section className="card more-card"><h2>Consultas</h2>{appointment ? <><Link className="appointment-summary" to={`/detalhes/appointments/${appointment.id}`}><b>Próxima consulta em {Math.ceil((new Date(appointment.at).getTime() - Date.now()) / 86400000)} dias</b><span>{eventDateTime(appointment.at)}</span></Link><Link className="secondary" to="/consulta">Cadastrar nova consulta</Link></> : <><p className="muted">Nenhuma consulta agendada</p><Link className="primary" to="/consulta">Cadastrar consulta</Link></>}</section><section className="card more-card"><h2>Dados e backup</h2><BackupActions />{!code ? <button className="danger" onClick={beginDelete}>Excluir dados locais</button> : <div className="delete-confirm"><p>Esta ação eliminará os registros locais deste dispositivo. Exporte um JSON antes de continuar.</p><p>Digite o código <b>{code}</b> para confirmar.</p><input className="field" inputMode="numeric" maxLength={6} value={typed} onChange={event => setTyped(event.target.value.replace(/\D/g, ''))} aria-label="Código de confirmação" /><div className="actions"><button className="danger" disabled={typed !== code || deleting} onClick={() => void clear()}>{deleting ? 'Excluindo…' : 'Confirmar exclusão'}</button><button className="secondary" disabled={deleting} onClick={() => setCode(undefined)}>Cancelar</button></div></div>}</section></div></Layout>
}

function AppRoutes() { return <Routes><Route path="/onboarding" element={<Onboarding />} /><Route path="/" element={<Home />} /><Route path="/glicemia" element={<RecordForm kind="glicemia" />} /><Route path="/glicemia/:id/editar" element={<RecordForm kind="glicemia" />} /><Route path="/refeicao" element={<RecordForm kind="refeicao" />} /><Route path="/refeicao/:id/editar" element={<RecordForm kind="refeicao" />} /><Route path="/insulina" element={<RecordForm kind="insulina" />} /><Route path="/insulina/:id/editar" element={<RecordForm kind="insulina" />} /><Route path="/treino" element={<RecordForm kind="treino" />} /><Route path="/treino/:id/editar" element={<RecordForm kind="treino" />} /><Route path="/consulta" element={<RecordForm kind="consulta" />} /><Route path="/consulta/:id/editar" element={<RecordForm kind="consulta" />} /><Route path="/episodio" element={<Episode />} /><Route path="/episodio/:id/editar" element={<Episode />} /><Route path="/detalhes/:table/:id" element={<Details />} /><Route path="/historico" element={<History />} /><Route path="/relatorio" element={<Report />} /><Route path="/mais" element={<More />} /><Route path="*" element={<Navigate to="/" />} /></Routes> }
class StorageBoundary extends React.Component<{ children: ReactNode }, { error: boolean }> { state = { error: false }; static getDerivedStateFromError() { return { error: true } }; componentDidCatch(error: Error) { console.error('Falha ao acessar registros locais', error) }; render() { return this.state.error ? <main className="shell"><section className="card"><h1>Não foi possível abrir os registros</h1><p role="alert">O armazenamento local está indisponível. Nenhum dado foi apagado.</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></section></main> : this.props.children } }
export function App() { return <StorageBoundary><AppRoutes /></StorageBoundary> }
