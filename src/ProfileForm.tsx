import { useState, type FormEvent } from 'react'
import { db, now, type Profile } from './database/db'
import { parseActivities } from './shared/records'
import { Button, usePersistence, ValidationError } from './shared/ui'

export const diagnoses = ['Diabetes tipo 1', 'Diabetes tipo 2', 'LADA', 'Diabetes gestacional', 'Outro', 'Prefiro não informar']
export function ProfileForm({ profile, onSaved }: { profile?: Profile; onSaved?: () => void }) {
  const { run, saving, error } = usePersistence()
  const [saved, setSaved] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaved(false)
    const form = new FormData(event.currentTarget)
    void run(async () => {
      const name = String(form.get('name') || '').trim()
      if (!name) throw new ValidationError('Informe seu nome de exibição.')
      await db.profiles.put({ ...profile, id: 'local', name, diagnosis: String(form.get('diagnosis') || '') || undefined,
        workoutActivities: parseActivities(String(form.get('activities') || '')), createdAt: profile?.createdAt || now(), updatedAt: now() })
      setSaved(true); onSaved?.()
    })
  }
  return <form className="profile-form" onSubmit={submit}><fieldset disabled={saving}>
    <label className="label">{profile ? 'Nome' : 'Como podemos chamar você?'}<input className="field" required name="name" defaultValue={profile?.name} placeholder="Nome de exibição" /></label>
    <label className="label">Diagnóstico informado pelo médico (opcional)<select className="field" name="diagnosis" defaultValue={profile?.diagnosis || ''}><option value="">Não informar agora</option>{diagnoses.map(x => <option key={x}>{x}</option>)}</select></label>
    <label className="label">Modalidades de treino habituais (opcional)<textarea className="field" name="activities" defaultValue={profile?.workoutActivities?.join('\n')} placeholder="Ex.: caminhada, musculação" /></label>
    <p className="muted">Separe por vírgula ou por linha. Você poderá editar em Mais &gt; Perfil.</p>
    <Button type="submit">{saving ? 'Salvando…' : profile ? 'Salvar perfil' : 'Concluir'}</Button>
  </fieldset>{error && <p role="alert">{error}</p>}{saved && profile && <p role="status">Perfil salvo neste dispositivo.</p>}</form>
}
