import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MealQuantityInput } from './MealQuantityInput'

afterEach(cleanup)
function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <><MealQuantityInput value={value} onChange={setValue} /><button>Outro campo</button></>
}
const input = () => screen.getByLabelText('Quantidade') as HTMLInputElement
const press = async (name: string) => userEvent.click(within(screen.getByRole('group', { name: 'Teclado da quantidade' })).getByRole('button', { name }))

it('digita decimal exato, apaga e limpa com teclado próprio sem habilitar teclado nativo', async () => {
  render(<Field />)
  await userEvent.click(input())
  expect(input()).toHaveAttribute('inputmode', 'none'); expect(input()).not.toHaveAttribute('readonly')
  for (const digit of ['1', '2', 'Separador decimal', '3', '4']) await press(digit)
  expect(input()).toHaveValue('12,34')
  await press('Apagar último caractere'); expect(input()).toHaveValue('12,3')
  input().setSelectionRange(0, 2); await press('5'); expect(input()).toHaveValue('5,3')
  await press('Limpar'); expect(input()).toHaveValue('')
  await press('Separador decimal'); expect(input()).toHaveValue('0,')
  await press('Concluir quantidade')
  expect(screen.queryByRole('group', { name: 'Teclado da quantidade' })).toBeNull()
  expect(input()).toHaveFocus()
})

it('não aceita um segundo separador ou excedente de precisão pelo teclado próprio', async () => {
  render(<Field initial="999999999999.999999" />)
  await userEvent.click(input()); input().setSelectionRange(19, 19)
  await press('9'); await press('Separador decimal')
  expect(input()).toHaveValue('999999999999.999999')
  expect(screen.getByRole('status')).toHaveTextContent('Nenhum valor será arredondado')
  input().setSelectionRange(0, 0); await press('1')
  expect(input()).toHaveValue('999999999999.999999')
})

it.each(['0,000001', '999999999999.999999'])('aceita colagem válida de %s sem converter para number', async value => {
  render(<Field />)
  await userEvent.click(input()); await userEvent.paste(value)
  expect(input()).toHaveValue(value)
})

it('preserva digitação física, seleção, vírgula e ponto e recusa colagem inválida', async () => {
  render(<Field />)
  await userEvent.type(input(), '12.340000')
  expect(input()).toHaveValue('12.340000')
  input().setSelectionRange(0, input().value.length); await userEvent.paste('1e3')
  expect(input()).toHaveValue('12.340000')
  expect(screen.getByRole('status')).toHaveTextContent('Cole uma quantidade decimal válida')
  await userEvent.clear(input()); await userEvent.type(input(), '1,5')
  await userEvent.keyboard('{Backspace}2'); expect(input()).toHaveValue('1,2')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('group', { name: 'Teclado da quantidade' })).toBeNull()
  await userEvent.click(input()); await userEvent.click(screen.getByRole('button', { name: 'Outro campo' }))
  expect(screen.queryByRole('group', { name: 'Teclado da quantidade' })).toBeNull()
})
