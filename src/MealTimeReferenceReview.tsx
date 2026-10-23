import { useRef, useState } from 'react'
import { classifyMealReferences, prepareMealReferencePreview, verifyMealReferenceBackup, type MealReferencePreview } from './database/mealTimeReference'
import { dateTime } from './shared/format'
import { Button, usePersistence } from './shared/ui'

export function MealTimeReferenceReview() {
  const [preview, setPreview] = useState<MealReferencePreview>()
  const [selected, setSelected] = useState<string[]>([])
  const [savedBackup, setSavedBackup] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [fileError, setFileError] = useState('')
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const { run, saving, error } = usePersistence()
  const reset = () => { generation.current++; setPreview(undefined); setSelected([]); setSavedBackup(''); setConfirmed(false); setFileError('') }
  const prepare = () => { reset(); setMessage(''); void run(async () => {
    const next = await prepareMealReferencePreview()
    if (!next.meals.length) { setMessage('Não há refeições com referência não confirmada.'); return }
    const url = URL.createObjectURL(new Blob([JSON.stringify(next.backup, null, 2)], { type: 'application/json' }))
    try { const link = document.createElement('a'); link.href = url; link.download = 'glicemio-antes-referencia-refeicoes.json'; link.click() }
    finally { URL.revokeObjectURL(url) }
    setPreview(next)
  }) }
  const readBackup = async (file?: File) => {
    const request = ++generation.current
    setSavedBackup(''); setFileError(''); setConfirmed(false)
    if (!file || !preview) return
    try {
      const content = await file.text()
      verifyMealReferenceBackup(preview, content)
      if (request === generation.current) setSavedBackup(content)
    } catch (cause) { if (request === generation.current) setFileError(cause instanceof Error ? cause.message : 'Não foi possível conferir o backup salvo.') }
  }
  const apply = () => { if (!preview) return; void run(async () => {
    const count = await classifyMealReferences(preview, selected, savedBackup, confirmed)
    reset(); setMessage(`${count} refeição(ões) classificada(s) como fim da refeição. Horários, identificadores e vínculos foram preservados.`)
  }) }
  return <div className="meal-reference-review">
    <h3>Referência dos horários das refeições antigas</h3>
    <p className="muted">Use somente para refeições suas cujo horário registrado corresponde ao fim da alimentação. Nenhuma classificação é automática.</p>
    <fieldset disabled={saving}>
      {!preview ? <Button type="button" onClick={prepare}>{saving ? 'Preparando…' : 'Preparar prévia e baixar backup'}</Button> : <>
        <p>Selecione as refeições que deseja identificar como <b>Fim da refeição</b>. Os horários não serão convertidos em início.</p>
        <p className="muted">Confira todas as refeições selecionadas, inclusive quando este dispositivo contém dados importados de outra pessoa.</p>
        <ul className="meal-reference-list">{preview.meals.map(meal => <li key={meal.id}><label><input type="checkbox" checked={selected.includes(meal.id)} onChange={event => { setConfirmed(false); setSelected(ids => event.target.checked ? [...ids, meal.id] : ids.filter(id => id !== meal.id)) }} /> {meal.kind} · {dateTime(meal.at)}{meal.description ? ` · ${meal.description}` : ''} — Referência não confirmada → Fim da refeição</label></li>)}</ul>
        <p>{selected.length} de {preview.meals.length} refeição(ões) selecionada(s).</p>
        <label className="label">Conferir o backup JSON que acabou de salvar<input className="field" type="file" accept="application/json,.json" onChange={event => void readBackup(event.target.files?.[0])} /></label>
        {savedBackup && <p role="status">Backup conferido: o arquivo contém os dados completos desta prévia.</p>}
        <label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Confirmo que as refeições selecionadas são minhas e que registrei o horário de fim da alimentação.</label>
        <div className="actions"><Button type="button" disabled={!savedBackup || !confirmed || !selected.length} onClick={apply}>{saving ? 'Classificando…' : 'Confirmar classificação como fim'}</Button><button type="button" className="secondary" onClick={reset}>Cancelar classificação</button></div>
      </>}
    </fieldset>
    {fileError && <p role="alert">{fileError}</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>
}
