import { useState, type FormEvent } from 'react'
import { db, now, type Profile } from './database/db'
import { cleanName, insulinCatalog, parseActivities } from './shared/records'
import { Button, usePersistence, ValidationError } from './shared/ui'

export const diagnoses = ['Diabetes tipo 1', 'Diabetes tipo 2', 'LADA', 'Diabetes gestacional', 'Outro', 'Prefiro não informar']
type InsulinUsage = 'yes'|'no'|'later'
const usageOptions: { value: InsulinUsage; label: string }[] = [{ value: 'yes', label: 'Sim' }, { value: 'no', label: 'Não' }, { value: 'later', label: 'Prefiro configurar depois' }]

function HabitualMedication({ label, kind, value, otherName, onChange, onOtherNameChange }: { label: string; kind: 'Basal/lenta'|'Rápida'; value: string; otherName: string; onChange: (value: string) => void; onOtherNameChange: (value: string) => void }) {
  return <><label className="label">{label}<select className="field" value={value} onChange={event => onChange(event.target.value)}><option value="">Não informar</option>{insulinCatalog.filter(item => item.kind === kind).map(item => <option key={item.id} value={item.id}>{item.name} — {item.brands}</option>)}<option value="other">Outra</option></select></label>{value === 'other' && <label className="label">Nome da insulina habitual<input className="field" value={otherName} onChange={event => onOtherNameChange(event.target.value)} /></label>}</>
}

export function ProfileForm({ profile, onSaved }: { profile?: Profile; onSaved?: () => void }) {
  const { run, saving, error } = usePersistence()
  const [saved, setSaved] = useState(false)
  const [basalUsage, setBasalUsage] = useState<InsulinUsage>(profile?.basalUsage || (profile?.basalReminderEnabled ? 'yes' : 'later'))
  const [frequency, setFrequency] = useState(profile?.basalFrequency || 'daily')
  const [basalMedicationId, setBasalMedicationId] = useState(profile?.basalMedicationId || '')
  const [basalMedicationName, setBasalMedicationName] = useState(profile?.basalMedicationName || '')
  const [rapidUsage, setRapidUsage] = useState<InsulinUsage>(profile?.rapidUsage || 'later')
  const [rapidMedicationId, setRapidMedicationId] = useState(profile?.rapidMedicationId || '')
  const [rapidMedicationName, setRapidMedicationName] = useState(profile?.rapidMedicationName || '')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaved(false)
    const form = new FormData(event.currentTarget)
    void run(async () => {
      const name = String(form.get('name') || '').trim()
      if (!name) throw new ValidationError('Informe seu nome de exibição.')
      if (basalUsage === 'yes' && basalMedicationId === 'other' && !cleanName(basalMedicationName)) throw new ValidationError('Informe o nome da insulina basal habitual.')
      if (rapidUsage === 'yes' && rapidMedicationId === 'other' && !cleanName(rapidMedicationName)) throw new ValidationError('Informe o nome da insulina rápida habitual.')
      await db.profiles.put({ ...profile, id: 'local', name, diagnosis: String(form.get('diagnosis') || '') || undefined,
        workoutActivities: parseActivities(String(form.get('activities') || '')), basalUsage, basalFrequency: basalUsage === 'yes' ? frequency : undefined, basalReminderEnabled: basalUsage === 'yes' && frequency === 'daily' && form.get('basalReminder') === 'on', basalReminderTime: String(form.get('basalReminderTime') || '21:00'), basalMedicationId: basalUsage === 'yes' ? basalMedicationId || undefined : undefined, basalMedicationName: basalUsage === 'yes' && basalMedicationId === 'other' ? cleanName(basalMedicationName) : undefined, rapidUsage, rapidMedicationId: rapidUsage === 'yes' ? rapidMedicationId || undefined : undefined, rapidMedicationName: rapidUsage === 'yes' && rapidMedicationId === 'other' ? cleanName(rapidMedicationName) : undefined, createdAt: profile?.createdAt || now(), updatedAt: now() })
      setSaved(true); onSaved?.()
    })
  }
  return <form className="profile-form" onSubmit={submit}><fieldset disabled={saving}>
    <section className="profile-subsection"><h3>Dados pessoais</h3><label className="label">{profile ? 'Nome' : 'Como podemos chamar você?'}<input className="field" required name="name" defaultValue={profile?.name} placeholder="Nome de exibição" /></label><label className="label">Diagnóstico informado pelo médico (opcional)<select className="field" name="diagnosis" defaultValue={profile?.diagnosis || ''}><option value="">Não informar agora</option>{diagnoses.map(item => <option key={item}>{item}</option>)}</select></label></section>
    <section className="profile-subsection"><h3>Modalidades de treino</h3><label className="label">Modalidades de treino habituais (opcional)<textarea className="field" name="activities" rows={4} defaultValue={profile?.workoutActivities?.join('\n')} placeholder="Ex.: caminhada, musculação" /></label><p className="muted">{profile ? 'Separe por vírgula ou pressione ↵ Enter para adicionar uma nova linha.' : 'Separe por vírgula ou por linha. Você poderá editar em Ajustes > Perfil.'}</p></section>
    <section className="profile-subsection"><h3>Rotina de insulina</h3><label className="label">Uso habitual de insulina basal<select className="field" value={basalUsage} onChange={event => setBasalUsage(event.target.value as InsulinUsage)}>{usageOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {basalUsage === 'yes' && <><HabitualMedication label="Insulina basal habitual (opcional)" kind="Basal/lenta" value={basalMedicationId} otherName={basalMedicationName} onChange={value => { setBasalMedicationId(value); if (value !== 'other') setBasalMedicationName('') }} onOtherNameChange={setBasalMedicationName} /><label className="label">Frequência habitual<select className="field" value={frequency} onChange={event => setFrequency(event.target.value as 'daily'|'other')}><option value="daily">Diária</option><option value="other">Outra frequência</option></select></label>{frequency === 'daily' && <><label className="check"><input name="basalReminder" type="checkbox" defaultChecked={profile?.basalReminderEnabled} /> Ativar lembrete de registro</label><label className="label">Horário habitual informado por você<input className="field" name="basalReminderTime" type="time" defaultValue={profile?.basalReminderTime || '21:00'} /></label></>}<p className="muted">O hábito informado é pessoal e não representa recomendação médica do aplicativo.</p></>}
    <label className="label">Uso habitual de insulina rápida/prandial<select className="field" value={rapidUsage} onChange={event => setRapidUsage(event.target.value as InsulinUsage)}>{usageOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{rapidUsage === 'yes' && <HabitualMedication label="Insulina rápida/prandial habitual (opcional)" kind="Rápida" value={rapidMedicationId} otherName={rapidMedicationName} onChange={value => { setRapidMedicationId(value); if (value !== 'other') setRapidMedicationName('') }} onOtherNameChange={setRapidMedicationName} />}</section>
    <Button type="submit">{saving ? 'Salvando…' : profile ? 'Salvar perfil' : 'Concluir'}</Button>
  </fieldset>{error && <p role="alert">{error}</p>}{saved && profile && <p role="status">Perfil salvo neste dispositivo.</p>}</form>
}
