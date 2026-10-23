import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('abre na top layer, contém foco, fecha por Escape/cancel e restaura foco', async () => {
  const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal'), close = vi.spyOn(HTMLDialogElement.prototype, 'close')
  function Example() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>Excluir</button>{open && <ConfirmDialog saving={false} onCancel={() => setOpen(false)} onConfirm={() => {}}>Texto extenso com nomes de alimentos para leitura.</ConfirmDialog>}</>
  }
  render(<Example />)
  const trigger = screen.getByRole('button', { name: 'Excluir' })
  await userEvent.click(trigger)
  const dialog = screen.getByRole('alertdialog'), cancel = within(dialog).getByRole('button', { name: 'Cancelar' }), confirm = within(dialog).getByRole('button', { name: 'Confirmar exclusão' })
  expect(show).toHaveBeenCalledOnce(); expect(dialog).toHaveAttribute('open'); expect(cancel).toHaveFocus()
  await userEvent.tab({ shift: true }); expect(confirm).toHaveFocus()
  await userEvent.tab(); expect(cancel).toHaveFocus()
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(close).toHaveBeenCalledOnce(); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(trigger).toHaveFocus()
})

it('impede fechamento durante a gravação e mantém os erros dentro do modal', () => {
  const cancel = vi.fn()
  render(<ConfirmDialog saving onCancel={cancel} onConfirm={() => {}} error="Falha transacional" />)
  const dialog = screen.getByRole('alertdialog')
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(cancel).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Excluindo…' })).toBeDisabled()
  expect(dialog).toContainElement(screen.getByRole('alert'))
})
