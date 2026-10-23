type DateTimeFieldsProps = {
  value: string
  onChange: (value: string) => void
  meaning?: string
  timeLabel?: string
}

// Mantenha a data/hora local sem fuso até a conversão ISO no salvamento.
export function DateTimeFields({ value, onChange, meaning, timeLabel = 'Hora' }: DateTimeFieldsProps) {
  const [date = '', time = ''] = value.split('T')

  return <div className="date-fields" role="group" aria-label={meaning ? `Data e hora — ${meaning}` : 'Data e hora'}>
    {meaning && <p className="muted date-meaning">{meaning}</p>}
    <label className="label">Data<input className="field" name="date" type="date" required value={date} onChange={event => onChange(`${event.target.value}T${time}`)} /></label>
    <label className="label">{timeLabel}<input className="field" name="time" type="time" step="60" required value={time} onChange={event => onChange(`${date}T${event.target.value}`)} /></label>
  </div>
}
