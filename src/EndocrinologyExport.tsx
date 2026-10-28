import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Appointment } from './database/db'
import { exportSinceEndocrinology, noEndocrinologyReference } from './database/appointmentExport'
import { consultationInterval, endocrinologyReferences } from './shared/appointments'
import { dateTime, localDayKey } from './shared/format'
import { downloadBackup } from './shared/downloadBackup'
import { useLocalClock } from './shared/useLocalClock'
import { Button } from './shared/ui'

export function EndocrinologyExport() {
  const appointments = useLiveQuery(() => db.appointments.toArray(), [])
  const clock = useLocalClock(), pending = useRef(false)
  const candidates = endocrinologyReferences(appointments ?? [], clock.getTime())
  const [selected, setSelected] = useState<Pick<Appointment, 'id' | 'at'>>()
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const reference = candidates.find(item => item.id === selected?.id && item.at === selected.at)
  const interval = reference ? consultationInterval(reference.at, clock.getTime()) : undefined
  const open = () => { setOpened(true); setSelected(candidates[0]); setError(''); setMessage('') }
  const download = async () => {
    if (!reference || pending.current) return
    pending.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await exportSinceEndocrinology(reference)
      downloadBackup(result.backup, `glicemio-endocrinologista-desde-${localDayKey(result.reference.at)}.json`)
      setMessage(result.clinicalCount ? `${result.clinicalCount} registro(s) clínico(s) no período exportado até ${dateTime(result.backup.exportedAt)}.` : 'Nenhum registro clínico no período. O arquivo contém a consulta de referência, o perfil existente e o contexto necessário, sem novas medições.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível exportar os dados.') }
    finally { pending.current = false; setBusy(false) }
  }
  return <div className="endocrinology-export">
    <button className="secondary export-option" type="button" disabled={appointments === undefined || !candidates.length} onClick={open}>Exportar desde a última consulta com o endocrinologista</button>
    {appointments !== undefined && !candidates.length && <p className="muted">{noEndocrinologyReference}</p>}
    {opened && <div className="backup-preview">
      <b>Exportação por período para análise</b><p className="muted">Este recorte pode incluir registros anteriores necessários aos vínculos. Ele não substitui um backup completo.</p>
      <label className="label">Consulta com o endocrinologista de referência<select className="field" disabled={busy} value={reference?.id ?? ''} onChange={event => { setSelected(candidates.find(item => item.id === event.target.value)); setError(''); setMessage('') }}>
        {!reference && <option value="">Selecione uma consulta confirmada</option>}
        {candidates.map(item => <option key={item.id} value={item.id}>{dateTime(item.at)}{item.professional ? ` · ${item.professional}` : ''}</option>)}
      </select></label>
      {reference && interval ? <><p>Referência: Endocrinologista · {dateTime(reference.at)}</p><p>Período: {dateTime(new Date(interval.from).toISOString())} até o instante da exportação ({dateTime(clock.toISOString())} agora).</p></> : <p role="status">A referência mudou ou não está mais disponível. Revise a seleção antes de exportar.</p>}
      <div className="actions"><Button type="button" disabled={!reference || busy} onClick={() => void download()}>{busy ? 'Exportando…' : 'Baixar JSON para análise'}</Button><button className="secondary" type="button" disabled={busy} onClick={() => setOpened(false)}>Cancelar</button></div>
    </div>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div>
}
