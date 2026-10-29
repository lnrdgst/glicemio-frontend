import { expect, it } from 'vitest'
import { formatMealItemQuantity } from './meals'

it.each([
  ['1', '1 fatia'], ['2', '2 fatias'], ['3', '3 fatias'],
  ['1.000000', '1,000000 fatia'], ['1.000001', '1,000001 fatias'],
  ['0.000001', '0,000001 fatias'], ['999999999999.999999', '999999999999,999999 fatias'],
])('apresenta %s fatia(s) com concordância e precisão exata', (quantity, expected) => {
  expect(formatMealItemQuantity({ quantity, unit: 'slice' })).toBe(expected)
})

it('mantém a apresentação de unidades anteriores', () => {
  expect(formatMealItemQuantity({ quantity: '1.250000', unit: 'cup' })).toBe('1,250000 · Xícara')
})
