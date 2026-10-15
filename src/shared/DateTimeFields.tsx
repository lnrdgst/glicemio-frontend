type DateTimeFieldsProps = {
  value: string
  onChange: (value: string) => void
}

// Mantenha a data/hora local sem fuso até a conversão ISO no salvamento.
export function DateTimeFields({ value, onChange }: DateTimeFieldsProps) {
  const [date = '', time = ''] = value.split('T')

  return <div className="date-fields" role="group" aria-label="Data e hora">
    <label className="label">Data<input className="field" name="date" type="date" required value={date} onChange={event => onChange(`${event.target.value}T${time}`)} /></label>
    <label className="label">Hora<input className="field" name="time" type="time" step="60" required value={time} onChange={event => onChange(`${date}T${event.target.value}`)} /></label>
  </div>
}
