import { useEffect, useId, useState } from 'react'
import type { Food } from '../database/db'
import { normalizedName } from './records'

export function FoodInput({ value, foods, onChange, onSelect, onCreate }: {
  value: string; foods: Food[]; onChange: (value: string) => void; onSelect: (food: Food) => void; onCreate: () => void
}) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1)
  const listId = useId()
  const matches = foods.filter(food => !food.deletedAt && normalizedName(food.name).includes(normalizedName(value))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id)).slice(0, 8)
  const canCreate = Boolean(value.trim()) && value.trim().length <= 200
  const count = matches.length + Number(canCreate), expanded = open && count > 0
  useEffect(() => {
    if (expanded && active >= 0 && active < count) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded, active, count, listId])
  const close = () => { setOpen(false); setActive(-1) }
  const choose = (index: number) => {
    if (index < matches.length) onSelect(matches[index])
    else onCreate()
    close()
  }
  return <div className="suggestions food-suggestions">
    <label className="label">Nome do alimento<input className="field" type="text" required maxLength={200} autoComplete="off" value={value} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && active >= 0 && active < count ? `${listId}-${active}` : undefined}
      onFocus={() => setOpen(true)} onBlur={close}
      onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close() }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && count) {
          event.preventDefault(); setOpen(true)
          setActive(index => index < 0 ? event.key === 'ArrowDown' ? 0 : count - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
        }
        if (event.key === 'Enter' && expanded) { event.preventDefault(); if (active >= 0 && active < count) choose(active); else close() }
      }} /></label>
    {expanded && <ul id={listId} role="listbox" aria-label="Sugestões de alimentos">
      {matches.map((food, index) => <li key={food.id} id={`${listId}-${index}`} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{food.name}</li>)}
      {canCreate && <li id={`${listId}-${matches.length}`} role="option" aria-selected={active === matches.length} onMouseDown={event => event.preventDefault()} onClick={() => choose(matches.length)}>Cadastrar “{value.trim()}” no catálogo</li>}
    </ul>}
  </div>
}
