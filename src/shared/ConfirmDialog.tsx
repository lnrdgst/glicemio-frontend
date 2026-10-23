import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ConfirmDialog({ saving, onCancel, onConfirm, error, children }: {
  saving: boolean; onCancel: () => void; onConfirm: () => void; error?: string; children?: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null)
  const titleId = useId(), descriptionId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, current = dialog.current!
    current.showModal() // Top layer nativa: fundo inerte, inclusive navegação fixa.
    cancel.current?.focus()
    return () => { current.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={dialog} className="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); if (!saving) onCancel() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (!buttons.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
    <h2 id={titleId}>Excluir este registro?</h2>
    <div id={descriptionId}>{children}<p>Esta ação não poderá ser desfeita.</p></div>
    {error && <p role="alert">{error}</p>}
    <div className="confirmation-actions"><button ref={cancel} className="secondary" type="button" disabled={saving} onClick={onCancel}>Cancelar</button><button className="danger" type="button" disabled={saving} onClick={onConfirm}>{saving ? 'Excluindo…' : 'Confirmar exclusão'}</button></div>
  </dialog>, document.body)
}
