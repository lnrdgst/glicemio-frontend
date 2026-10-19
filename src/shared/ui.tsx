import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Activity, CalendarDays, ChartNoAxesCombined, MoreHorizontal, type LucideIcon } from 'lucide-react'

export const Button = ({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button className={['primary', className].filter(Boolean).join(' ')} {...props}>{children}</button>
export const scrollToTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
export function Layout({ children, onBeforeNavigate }: { children: ReactNode; onBeforeNavigate?: () => boolean }) {
  const links: [string, LucideIcon, string][] = [['/', Activity, 'Início'], ['/historico', CalendarDays, 'Histórico'], ['/relatorio', ChartNoAxesCombined, 'Relatório'], ['/mais', MoreHorizontal, 'Ajustes']]
  return <div className="shell">{children}<nav className="nav" aria-label="Navegação principal">{links.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === '/'} onClick={event => { if (onBeforeNavigate && !onBeforeNavigate()) { event.preventDefault(); return } if (event.currentTarget.getAttribute('aria-current') === 'page') { event.preventDefault(); scrollToTop() } }}><Icon size={20} /><span>{label}</span></NavLink>)}</nav></div>
}
export function usePersistence() {
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const run = async (save: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true; setSaving(true); setError('')
    try { await save() }
    catch (err) {
      console.error('Falha no registro local', err)
      const validation = err instanceof ValidationError ? err.message : 'Não foi possível salvar o registro neste dispositivo. Seus dados preenchidos foram mantidos. Tente novamente.'
      setError(validation)
    } finally { pending.current = false; setSaving(false) }
  }
  return { run, saving, error }
}
export class ValidationError extends Error {}
