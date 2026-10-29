import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './database/db'
import { formatMealItemQuantity } from './shared/meals'

export function MealItemsSummary({ mealId }: { mealId: string }) {
  const items = useLiveQuery(() => db.transaction('r', [db.meals, db.mealItems], async () => (await db.meals.get(mealId))?.deletedAt ? [] : db.mealItems.where('mealId').equals(mealId).filter(item => !item.deletedAt).toArray()), [mealId])
  if (!items?.length) return null
  return <section className="meal-items-summary" aria-label="Alimentos consumidos">
    <h2>Alimentos consumidos</h2>
    <ul>{items.map(item => <li key={item.id}><span>{item.foodName}</span><span className="muted">{formatMealItemQuantity(item)}</span></li>)}</ul>
  </section>
}
