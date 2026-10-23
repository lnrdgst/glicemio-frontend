import { useId, useLayoutEffect, useRef, useState } from 'react'

const draftPattern = /^\d{0,12}(?:[.,]\d{0,6})?$/
const limitMessage = 'Use até 12 dígitos inteiros e 6 casas decimais. Nenhum valor será arredondado.'

/** Entrada textual exata: inputMode=none evita o teclado nativo sem impedir teclado físico/colar. */
export function MealQuantityInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null), keypadId = useId(), hintId = useId()
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  const pendingCaret = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (pendingCaret.current === undefined) return
    input.current?.focus(); input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = undefined
  }, [value])
  const apply = (next: string, caret: number) => {
    if (!draftPattern.test(next)) { setError(limitMessage); return }
    pendingCaret.current = caret
    setError(''); onChange(next)
  }
  const insert = (text: string) => {
    const start = input.current?.selectionStart ?? value.length, end = input.current?.selectionEnd ?? start
    const next = value.slice(0, start) + text + value.slice(end)
    apply(next, start + text.length)
  }
  const erase = () => {
    const start = input.current?.selectionStart ?? value.length, end = input.current?.selectionEnd ?? start
    const from = start === end ? Math.max(0, start - 1) : start
    apply(value.slice(0, from) + value.slice(end), from)
  }
  const close = () => { input.current?.focus(); setOpen(false) }
  return <div className="meal-quantity-control" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label className="label">Quantidade<input ref={input} className="field" type="text" inputMode="none" autoComplete="off" required placeholder="Ex.: 0,5" value={value} aria-controls={open ? keypadId : undefined} aria-expanded={open} aria-describedby={error ? hintId : undefined} aria-invalid={Boolean(error)}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onChange={event => { const next = event.target.value; onChange(next); setError(next && !draftPattern.test(next) ? limitMessage : '') }}
      onPaste={event => {
        event.preventDefault()
        const pasted = event.clipboardData.getData('text').trim()
        if (!/^\d{1,12}(?:[.,]\d{1,6})?$/.test(pasted) || !/[1-9]/.test(pasted)) { setError('Cole uma quantidade decimal válida, maior que zero, sem arredondamento.'); return }
        insert(pasted)
      }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close() } }} /></label>
    {error && <p id={hintId} className="muted quantity-error" role="status">{error}</p>}
    {open && <div className="decimal-keypad" id={keypadId} role="group" aria-label="Teclado da quantidade">
      <div className="decimal-keypad-digits">{['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'apagar'].map(key => <button key={key} className="secondary" type="button" aria-label={key === ',' ? 'Separador decimal' : key === 'apagar' ? 'Apagar último caractere' : key} onPointerDown={event => event.preventDefault()} onClick={() => key === 'apagar' ? erase() : insert(key === ',' && !value ? '0,' : key)}>{key === 'apagar' ? '⌫' : key}</button>)}</div>
      <div className="decimal-keypad-actions"><button className="secondary" type="button" disabled={!value} onPointerDown={event => event.preventDefault()} onClick={() => apply('', 0)}>Limpar</button><button className="secondary" type="button" onPointerDown={event => event.preventDefault()} onClick={close}>Concluir quantidade</button></div>
    </div>}
  </div>
}
