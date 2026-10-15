import * as React from 'react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Droplets, Dumbbell, Soup, Syringe, TriangleAlert } from 'lucide-react'
import { db, now, stamp, type Meal } from './database/db'
import { RecordForm, type RecordKind } from './RecordForm'
import { ProfileForm } from './ProfileForm'
import { insulinName } from './shared/records'
import { Button, Layout, usePersistence } from './shared/ui'
import { dateTime, duration, relative, time } from './shared/format'

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
  return <main className="shell onboarding"><section className="card"><span style={{ color: '#d7865b' }}>GLICOPONTO</span><h1>Vamos começar pelo essencial.</h1><p className="muted">Seus registros ficam neste dispositivo durante esta versão de desenvolvimento.</p><ProfileForm onSaved={() => nav('/', { replace: true })} /></section></main>
}

function useProfile() { return useLiveQuery(() => db.profiles.get('local').then(value => value ?? null), []) }

function Home() {
  const location = useLocation(); const profile = useProfile()
  const glucose = useLiveQuery(() => db.glucose.orderBy('at').last(), [])
  const meals = useLiveQuery(() => db.meals.orderBy('at').reverse().limit(3).toArray(), []) ?? []
  const workouts = useLiveQuery(() => db.workouts.orderBy('startedAt').reverse().limit(3).toArray(), []) ?? []
  const appointment = useLiveQuery(() => db.appointments.filter(x => new Date(x.at) > new Date()).sortBy('at'), [])?.[0]
  if (profile === undefined) return <main className="shell" />
  if (!profile) return <Navigate to="/onboarding" replace />
  return <Layout>{location.state?.success && <p role="status">{location.state.success}</p>}<header><span style={{ color: '#d7865b', fontWeight: 800, letterSpacing: 2 }}>GLICOPONTO</span><h1 style={{ marginBottom: 4 }}>Olá, {profile.name}</h1>{profile.diagnosis && <p className="muted">{profile.diagnosis}</p>}</header>
    {glucose ? <Link className="home-record card" to={`/detalhes/glucose/${glucose.id}`}><span className="muted">Última medição</span><h2 style={{ fontSize: '2.3rem', margin: '6px 0' }}>{glucose.value} <small>mg/dL</small></h2><p className="muted">{glucose.context || 'Sem contexto'} · registrada {relative(glucose.at)}</p>{glucose.mealId && <p className="muted">Associada a uma refeição</p>}</Link> : <section className="card" style={{ margin: '22px 0' }}><h2>Nenhuma medição ainda</h2><p className="muted">Registre seu primeiro Ponto para acompanhar seu contexto.</p></section>}
    <InsulinSummary />
    <div className="quick"><Link to="/glicemia"><Droplets size={22} /><br />Registrar glicemia</Link><Link to="/refeicao"><Soup size={22} /><br />Registrar refeição</Link><Link to="/insulina"><Syringe size={22} /><br />Registrar insulina</Link><Link to="/treino"><Dumbbell size={22} /><br />Registrar treino</Link><Link to="/episodio" className="symptoms"><TriangleAlert size={22} /><br />Estou com sintomas</Link></div>
    <HomeList title="Últimas refeições" empty="Nenhuma refeição registrada." items={meals} render={(record: Meal) => <><span>{record.kind}</span><span className="muted">{time(record.at)}</span></>} table="meals" />
    <HomeList title="Últimos treinos" empty="Nenhum treino registrado." items={workouts} render={record => <><span>{record.activity}</span><span className="muted">{duration(record.startedAt, record.endedAt)}</span></>} table="workouts" />
    {appointment && <Link className="card home-record" to={`/detalhes/appointments/${appointment.id}`}><b>Próxima consulta</b><p>{dateTime(appointment.at)}</p><p className="muted">{appointment.professional || 'Profissional não informado'} · em {Math.ceil((new Date(appointment.at).getTime() - Date.now()) / 86400000)} dias</p></Link>}
  </Layout>
}

function InsulinSummary() {
  const applications = useLiveQuery(() => db.insulin.orderBy('at').reverse().toArray(), []) ?? []
  const basal = applications.find(x => x.kind === 'Basal/lenta'); const rapid = applications.find(x => x.kind === 'Rápida')
  if (!basal && !rapid) return <section className="card insulin-summary"><h2>Últimas aplicações de insulina</h2><p className="muted">Nenhuma aplicação registrada.</p></section>
  const line = (label: string, application: typeof basal, divider = false) => application && <Link className="insulin-line" style={{ borderTop: divider ? '1px solid #39322e' : undefined }} to={`/detalhes/insulin/${application.id}`}><div><b>{label}</b>{insulinName(application) && <p>{insulinName(application)}</p>}<p className="muted">{dateTime(application.at)}</p></div><strong>{application.dose.toLocaleString('pt-BR')} UI</strong></Link>
  return <section className="card insulin-summary"><h2>Últimas aplicações de insulina</h2>{line('Basal / lenta', basal)}{line('Rápida', rapid, Boolean(basal))}</section>
}

function HomeList({ title, empty, items, render, table }: { title: string; empty: string; items: any[]; render: (item: any) => React.ReactNode; table: string }) {
  return <section style={{ marginTop: 22 }}><div className="row"><h2 style={{ fontSize: '1.1rem' }}>{title}</h2><Link to="/historico" style={{ color: '#d7865b' }}>Ver histórico</Link></div><div className="card">{items.length ? items.map(item => <Link className="home-list-item row" key={item.id} to={`/detalhes/${table}/${item.id}`}>{render(item)}</Link>) : <p className="muted">{empty}</p>}</div></section>
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
  return <Layout><Link to="/" className="muted">← Início</Link><section className="card details"><span className="muted">{config.title}</span><h1>{detail}</h1><p>{dateTime(at)}</p>{record.note && <p className="muted">{record.note}</p>}{record.description && <p className="muted">{record.description}</p>}<Link className="primary" to={config.edit === 'episodio' ? `/episodio/${id}/editar` : `/${config.edit}/${id}/editar`}>Editar</Link></section></Layout>
}

type Line = { id: string; at: string; title: string; detail?: string; table: string; recordId: string }
function History() {
  const [glucose, meals, insulin, workouts, episodes, appointments] = useLiveQuery(async () => Promise.all([db.glucose.toArray(), db.meals.toArray(), db.insulin.toArray(), db.workouts.toArray(), db.episodes.toArray(), db.appointments.toArray()]), []) ?? [[], [], [], [], [], []]
  const lines: Line[] = [...glucose.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `${x.value} mg/dL`, detail: x.context, table: 'glucose' })), ...meals.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: x.kind, detail: x.description, table: 'meals' })), ...insulin.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: `Insulina ${x.kind}`, detail: `${insulinName(x) ? `${insulinName(x)} · ` : ''}${x.dose.toLocaleString('pt-BR')} UI`, table: 'insulin' })), ...workouts.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Treino', detail: x.activity, table: 'workouts' })), ...episodes.map(x => ({ id: x.id, recordId: x.id, at: x.startedAt, title: 'Episódio', detail: x.symptoms.join(', '), table: 'episodes' })), ...appointments.map(x => ({ id: x.id, recordId: x.id, at: x.at, title: 'Consulta', detail: x.professional, table: 'appointments' }))].sort((a, b) => +new Date(b.at) - +new Date(a.at))
  return <Layout><h1>Histórico</h1>{lines.length ? <div className="timeline">{lines.map(line => <div className="item" key={line.id}><div className="row"><Link className="history-link" to={`/detalhes/${line.table}/${line.recordId}`}><b>{time(line.at)} · {line.title}</b><span className="muted">{line.detail}</span><span className="muted">{dateTime(line.at)}</span></Link><Delete run={() => db.table(line.table).delete(line.recordId)} /></div></div>)}</div> : <section className="card"><p>Nenhum registro ainda.</p></section>}</Layout>
}

function Report() {
  const [period, setPeriod] = useState(30); const data = useLiveQuery(async () => { const since = Date.now() - period * 86400000; const [g, m, i, w, e] = await Promise.all([db.glucose.toArray(), db.meals.toArray(), db.insulin.toArray(), db.workouts.toArray(), db.episodes.toArray()]); return { g: g.filter(x => +new Date(x.at) >= since), m: m.filter(x => +new Date(x.at) >= since), i: i.filter(x => +new Date(x.at) >= since), w: w.filter(x => +new Date(x.startedAt) >= since), e: e.filter(x => +new Date(x.startedAt) >= since) } }, [period]); const values = data?.g.map(x => x.value) ?? []; const cards = [['Medições', values.length], ['Mínima', values.length ? `${Math.min(...values)} mg/dL` : '—'], ['Máxima', values.length ? `${Math.max(...values)} mg/dL` : '—'], ['Média aritmética simples', values.length ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(0)} mg/dL` : '—'], ['Refeições', data?.m.length ?? 0], ['Aplicações de insulina', data?.i.length ?? 0], ['Treinos', data?.w.length ?? 0], ['Episódios', data?.e.length ?? 0]]; return <Layout><h1>Relatório</h1><label className="label">Período<select className="field" value={period} onChange={e => setPeriod(Number(e.target.value))}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label><div className="report-cards">{cards.map(([title, value]) => <section className="card" key={String(title)}><span className="muted">{title}</span><h2>{value}</h2></section>)}</div></Layout>
}

function More() {
  const profile = useLiveQuery(() => db.profiles.get('local'), []); const nav = useNavigate()
  const exportData = async () => { const out = await Promise.all(['profiles', 'glucose', 'meals', 'insulin', 'workouts', 'episodes', 'appointments'].map(async table => [table, await db.table(table).toArray()])); const url = URL.createObjectURL(new Blob([JSON.stringify(Object.fromEntries(out), null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'glicoponto-dados.json'; link.click(); URL.revokeObjectURL(url) }
  const clear = async () => { if (confirm('Excluir todos os dados locais deste dispositivo? Esta ação não pode ser desfeita.')) { await db.transaction('rw', db.tables, () => Promise.all(db.tables.map(table => table.clear()))); nav('/onboarding') } }
  return <Layout><h1>Mais</h1><div className="more-sections"><section className="card more-card"><h2>Perfil</h2>{profile && <ProfileForm key={profile.id} profile={profile} />}</section><section className="card more-card"><h2>Consultas</h2><Link className="primary" to="/consulta">Cadastrar consulta</Link></section><section className="card more-card"><h2>Privacidade</h2><div className="actions"><Button onClick={exportData}>Exportar JSON</Button><button className="danger" onClick={clear}>Excluir dados locais</button></div></section></div></Layout>
}

function AppRoutes() { return <Routes><Route path="/onboarding" element={<Onboarding />} /><Route path="/" element={<Home />} /><Route path="/glicemia" element={<RecordForm kind="glicemia" />} /><Route path="/glicemia/:id/editar" element={<RecordForm kind="glicemia" />} /><Route path="/refeicao" element={<RecordForm kind="refeicao" />} /><Route path="/refeicao/:id/editar" element={<RecordForm kind="refeicao" />} /><Route path="/insulina" element={<RecordForm kind="insulina" />} /><Route path="/insulina/:id/editar" element={<RecordForm kind="insulina" />} /><Route path="/treino" element={<RecordForm kind="treino" />} /><Route path="/treino/:id/editar" element={<RecordForm kind="treino" />} /><Route path="/consulta" element={<RecordForm kind="consulta" />} /><Route path="/consulta/:id/editar" element={<RecordForm kind="consulta" />} /><Route path="/episodio" element={<Episode />} /><Route path="/episodio/:id/editar" element={<Episode />} /><Route path="/detalhes/:table/:id" element={<Details />} /><Route path="/historico" element={<History />} /><Route path="/relatorio" element={<Report />} /><Route path="/mais" element={<More />} /><Route path="*" element={<Navigate to="/" />} /></Routes> }
class StorageBoundary extends React.Component<{ children: ReactNode }, { error: boolean }> { state = { error: false }; static getDerivedStateFromError() { return { error: true } }; componentDidCatch(error: Error) { console.error('Falha ao acessar registros locais', error) }; render() { return this.state.error ? <main className="shell"><section className="card"><h1>Não foi possível abrir os registros</h1><p role="alert">O armazenamento local está indisponível. Nenhum dado foi apagado.</p><Button onClick={() => window.location.reload()}>Tentar novamente</Button></section></main> : this.props.children } }
export function App() { return <StorageBoundary><AppRoutes /></StorageBoundary> }
