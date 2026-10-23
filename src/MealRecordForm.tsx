import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db, stamp, type Meal, type MealItem } from './database/db'
import { draftFromMealItem, MealFormError, nextMealUpdate, saveMealForm, type MealItemDraft } from './database/mealForm'
import { MealItemsEditor } from './MealItemsEditor'
import { DateTimeFields } from './shared/DateTimeFields'
import { iso, localInput } from './shared/format'
import { MealTimeReferenceNote } from './shared/MealTimeReferenceNote'
import { mealTimeFieldLabel, mealTimeReferenceLabel } from './shared/meals'
import { suggestedMealKind } from './shared/records'
import { Button, Layout, usePersistence, ValidationError } from './shared/ui'

type Snapshot = { id: string; meal?: Meal; items: MealItem[]; error?: boolean }
export function MealRecordForm() {
  const { id } = useParams()
  const [loaded, setLoaded] = useState<Snapshot>(), [attempt, retry] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    db.transaction('r', [db.meals, db.mealItems], async () => ({ id, meal: await db.meals.get(id), items: (await db.mealItems.where('mealId').equals(id).toArray()).filter(item => !item.deletedAt) }))
      .then(snapshot => { if (active) setLoaded(snapshot) })
      .catch(() => { if (active) setLoaded({ id, items: [], error: true }) })
    return () => { active = false }
  }, [id, attempt])
  if (id && loaded?.id !== id) return <Layout><h1>Carregando registro…</h1></Layout>
  if (id && loaded?.error) return <Layout><Link to="/historico">← Voltar</Link><p role="alert">Não foi possível carregar a refeição e seus alimentos.</p><button type="button" className="secondary" onClick={() => { setLoaded(undefined); retry(value => value + 1) }}>Tentar novamente</button></Layout>
  if (id && (!loaded?.meal || loaded.meal.deletedAt)) return <Layout><Link to="/historico" className="muted">← Voltar</Link><section className="card"><h1>Registro não encontrado</h1></section></Layout>
  return <MealForm key={id ?? 'new'} original={id ? loaded?.meal : undefined} originalItems={id ? loaded!.items : []} />
}

function MealForm({ original, originalItems }: { original?: Meal; originalItems: MealItem[] }) {
  const nav = useNavigate(), { run, saving, error } = usePersistence()
  const [at, setAt] = useState(() => original ? localInput(original.at) : localInput())
  const [kind, setKind] = useState(() => original?.kind ?? suggestedMealKind(localInput()) ?? '')
  const [kindTouched, setKindTouched] = useState(Boolean(original)), [dirty, setDirty] = useState(false)
  const [description, setDescription] = useState(original?.description ?? '')
  const [items, setItems] = useState<MealItemDraft[]>(() => originalItems.map(draftFromMealItem))
  const reference = original ?? { timeReference: 'meal_start' as const }
  useEffect(() => { if (!original && !kindTouched) setKind(suggestedMealKind(at) ?? '') }, [at, kindTouched, original])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const canLeave = () => !dirty || window.confirm('Há alterações não salvas. Deseja sair sem salvar?')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run(async () => {
      if (!kind) throw new ValidationError('Selecione o tipo de refeição.')
      let effectiveAt: string
      try { effectiveAt = original && at === localInput(original.at) ? original.at : iso(at) }
      catch { throw new ValidationError('Informe uma data e um horário válidos.') }
      const value = { kind, at: effectiveAt, description: original && description === (original.description ?? '') ? original.description : description.trim() || undefined }
      const meal = original ? { ...original, ...value, updatedAt: nextMealUpdate(original.updatedAt) } : stamp({ ...value, timeReference: 'meal_start' as const })
      try { await saveMealForm(meal, items, originalItems, original) }
      catch (cause) { if (cause instanceof MealFormError) throw new ValidationError(cause.message); throw cause }
      nav('/', { replace: true, state: { success: original ? 'Alterações salvas neste dispositivo.' : 'Registro salvo neste dispositivo.' } })
    })
  }
  return <Layout onBeforeNavigate={canLeave}>
    <Link to={original ? `/detalhes/meals/${original.id}` : '/'} className="muted" onClick={event => { if (!canLeave()) event.preventDefault() }}>← Voltar</Link>
    <h1 className="form-title form-title-refeicao">{original ? 'Editar refeição' : 'Registrar refeição'}</h1>
    <form className="card" onSubmit={submit} onChange={() => setDirty(true)}>
      <fieldset disabled={saving}>
        <label className="label">Tipo de refeição<select className="field" name="kind" required value={kind} onChange={event => { setKindTouched(true); setKind(event.target.value) }}><option value="">Selecionar</option>{['Café da manhã', 'Almoço', 'Jantar', 'Lanche', 'Outro'].map(name => <option key={name}>{name}</option>)}</select></label>
        <DateTimeFields value={at} onChange={setAt} meaning={mealTimeReferenceLabel(reference)} timeLabel={mealTimeFieldLabel(reference)} />
        {original && <MealTimeReferenceNote meal={original} />}
        <MealItemsEditor items={items} onChange={next => { setItems(next); setDirty(true) }} />
        <label className="label">Descrição (opcional)<textarea className="field" name="description" maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <div className="actions"><Button className="form-save form-save-refeicao" type="submit">{saving ? 'Salvando…' : original ? 'Salvar alterações da refeição' : 'Salvar registro de refeição'}</Button></div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  </Layout>
}
