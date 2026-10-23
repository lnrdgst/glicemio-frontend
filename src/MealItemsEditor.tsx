import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { db, type MealItemUnit } from './database/db'
import { emptyMealItem, type MealItemDraft } from './database/mealForm'
import { FoodInput } from './shared/FoodInput'
import { mealUnitLabels, sortedMealItemUnits } from './shared/meals'
import { MealQuantityInput } from './shared/MealQuantityInput'

export function MealItemsEditor({ items, onChange }: { items: MealItemDraft[]; onChange: (items: MealItemDraft[]) => void }) {
  const [focusId, setFocusId] = useState<string>(), addButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focusId) return
    const target = focusId === 'add' ? addButton.current : document.getElementById(`meal-item-${focusId}`)?.querySelector<HTMLInputElement>('input')
    target?.focus(); setFocusId(undefined)
  }, [focusId, items])
  const catalog = useLiveQuery(async () => {
    try { return { foods: await db.foods.toArray(), error: false } }
    catch { return { foods: [], error: true } }
  }, [])
  const update = (index: number, patch: Partial<MealItemDraft>) => onChange(items.map((item, i) => i === index ? { ...item, ...patch } : item))
  return <section className="meal-items-editor" aria-labelledby="meal-items-title">
    <h2 id="meal-items-title">Alimentos consumidos</h2>
    <p className="muted">Opcional. Adicione os alimentos ou mantenha somente a descrição livre.</p>
    {catalog?.error && <p className="muted" role="status">Não foi possível carregar as sugestões do catálogo. Você pode preencher os alimentos manualmente.</p>}
    {items.map((item, index) => <fieldset key={item.id} id={`meal-item-${item.id}`} className="meal-item">
      <legend>Alimento {index + 1}</legend>
      <FoodInput value={item.foodName} foods={catalog?.foods ?? []}
        onChange={foodName => update(index, { foodName, foodId: undefined })}
        onSelect={food => update(index, { foodName: food.name, foodId: food.id })} />
      <div className="meal-item-amount">
        <MealQuantityInput value={item.quantity} onChange={quantity => update(index, { quantity })} />
        <label className="label">Unidade<select className="field" required value={item.unit} onChange={event => update(index, { unit: event.target.value as MealItemUnit | '' })}>
          <option value="">Selecionar</option>{sortedMealItemUnits.map(unit => <option key={unit} value={unit}>{mealUnitLabels[unit]}</option>)}
        </select></label>
      </div>
      <div className="meal-item-footer">
        <p className="muted">{item.foodId ? 'Vinculado ao catálogo. O nome consumido será preservado.' : 'Ao salvar, novos alimentos entram no catálogo. Nomes históricos são preservados.'}</p>
        <button className="danger" type="button" aria-label={`Remover alimento ${index + 1}`} onClick={() => { onChange(items.filter((_, i) => i !== index)); setFocusId(items[index + 1]?.id ?? items[index - 1]?.id ?? 'add') }}><Trash2 size={16} aria-hidden="true" />Remover</button>
      </div>
    </fieldset>)}
    <button ref={addButton} className="secondary meal-add-item" type="button" onClick={() => { const item = emptyMealItem(); onChange([...items, item]); setFocusId(item.id) }}><Plus size={18} aria-hidden="true" />Adicionar alimento</button>
    {items.length > 0 && <p className="muted meal-quantity-hint">Use vírgula ou ponto, com até 6 casas decimais. Medidas caseiras não são convertidas em gramas.</p>}
  </section>
}
