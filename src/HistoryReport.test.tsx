import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'
import { appointmentCountdown, appointmentDateTime, eventDateTime, weekdayEventDateTime } from './shared/format'

const open = (route: string) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString()

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('formata Hoje, Ontem e datas anteriores pelo calendário local', () => {
  const reference = new Date(2026, 9, 15, 0, 5)
  expect(eventDateTime(new Date(2026, 9, 15, 0, 1).toISOString(), reference)).toBe('Hoje, às 00:01')
  expect(eventDateTime(new Date(2026, 9, 14, 23, 59).toISOString(), reference)).toBe('Ontem, às 23:59')
  expect(eventDateTime(new Date(2026, 9, 13, 23, 59).toISOString(), reference)).toBe('13/10/2026 às 23:59')
})

it('formata o dia da semana, data e hora local das próximas consultas', () => {
  expect(weekdayEventDateTime(new Date(2027, 0, 13, 13, 50).toISOString())).toBe('Quarta-feira, 13/01/2027 às 13:50')
  expect(weekdayEventDateTime(new Date(2027, 0, 1, 10, 30).toISOString())).toBe('Sexta-feira, 01/01/2027 às 10:30')
})

it('usa calendário local e tempo restante real nas próximas consultas', () => {
  const reference = new Date(2026, 11, 31, 20, 0)
  expect(appointmentDateTime(new Date(2026, 11, 31, 22, 30).toISOString(), reference)).toBe('Hoje, 31/12/2026 às 22:30')
  expect(appointmentDateTime(new Date(2027, 0, 1, 10, 30).toISOString(), reference)).toBe('Amanhã, 01/01/2027 às 10:30')
  expect(appointmentDateTime(new Date(2027, 0, 6, 10, 30).toISOString(), reference)).toBe('Quarta-feira, 06/01/2027 às 10:30')
  expect(appointmentCountdown(new Date(2027, 0, 2, 20, 0).toISOString(), reference)).toBe('em 2 dias')
  expect(appointmentCountdown(new Date(2027, 0, 1, 10, 30).toISOString(), reference)).toBe('em 14h30min')
  expect(appointmentCountdown(new Date(2026, 11, 31, 22, 0).toISOString(), reference)).toBe('em 2h')
  expect(appointmentCountdown(new Date(2026, 11, 31, 21, 45).toISOString(), reference)).toBe('em 1h45min')
  expect(appointmentCountdown(new Date(2026, 11, 31, 20, 45).toISOString(), reference)).toBe('em 45min')
  expect(appointmentCountdown(new Date(2026, 11, 31, 20, 0, 30).toISOString(), reference)).toBe('em menos de 1 minuto')
})

it('separa a timeline em Hoje, Ontem e data completa', async () => {
  const current = new Date(); const today = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 10); const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1, 10); const older = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 2, 10)
  await db.glucose.bulkAdd([stamp({ value: 100, at: today.toISOString() }), stamp({ value: 101, at: yesterday.toISOString() }), stamp({ value: 102, at: older.toISOString() })])
  open('/historico')
  await screen.findByRole('link', { name: /100 mg\/dL/ })
  expect(screen.getByText(/Hoje ·/)).toBeInTheDocument()
  expect(screen.getByText(/Ontem ·/)).toBeInTheDocument()
  expect(screen.getByText(`${String(older.getDate()).padStart(2, '0')}/${String(older.getMonth() + 1).padStart(2, '0')}/${older.getFullYear()}`)).toBeInTheDocument()
})

it('agrupa o histórico por dia e carrega registros em lotes sem duplicação', async () => {
  await db.glucose.bulkAdd(Array.from({ length: 25 }, (_, index) => stamp({ value: 100 + index, at: minutesAgo(index) })))
  open('/historico')
  await screen.findByRole('link', { name: /100 mg\/dL/ })
  expect(screen.getByText(/Hoje ·/)).toBeInTheDocument()
  expect(document.querySelectorAll('.history-link')).toHaveLength(20)
  await userEvent.click(screen.getByRole('button', { name: 'Carregar registros anteriores' }))
  await waitFor(() => expect(document.querySelectorAll('.history-link')).toHaveLength(25))
  expect(screen.queryByRole('button', { name: 'Carregar registros anteriores' })).toBeNull()
  const hrefs = [...document.querySelectorAll<HTMLAnchorElement>('.history-link')].map(link => link.getAttribute('href'))
  expect(new Set(hrefs).size).toBe(25)
})

it('aplica filtros antes da paginação e preserva a abertura dos detalhes', async () => {
  await db.glucose.bulkAdd(Array.from({ length: 21 }, (_, index) => stamp({ value: 100 + index, at: minutesAgo(index) })))
  const meal = stamp({ kind: 'Almoço', at: minutesAgo(1) }); await db.meals.add(meal)
  open('/historico'); await screen.findByRole('link', { name: /100 mg\/dL/ })
  await userEvent.click(screen.getByRole('button', { name: 'Refeições' }))
  expect(await screen.findByRole('link', { name: /Almoço/ })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /100 mg\/dL/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Carregar registros anteriores' })).toBeNull()
  await userEvent.click(screen.getByRole('link', { name: /Almoço/ }))
  expect(await screen.findByRole('link', { name: 'Editar' })).toHaveAttribute('href', `/refeicao/${meal.id}/editar`)
})

it('separa indicadores de glicemia, acontecimentos e estados vazios no relatório', async () => {
  open('/relatorio')
  expect(await screen.findByText('Nenhuma medição cadastrada neste período.')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /gráfico de glicemia/i })).toBeNull()
  await db.glucose.bulkAdd([stamp({ value: 90, at: minutesAgo(10) }), stamp({ value: 150, at: minutesAgo(20) })])
  await db.meals.add(stamp({ kind: 'Almoço', at: minutesAgo(30) }))
  await db.insulin.add(stamp({ kind: 'Rápida', dose: 4, at: minutesAgo(40) }))
  await waitFor(() => expect(screen.getByText('120 mg/dL')).toBeInTheDocument())
  expect(screen.getByText('Glicemia')).toBeInTheDocument()
  expect(screen.getByText('Acontecimentos registrados')).toBeInTheDocument()
  expect(screen.getByText(/média considera somente as medições cadastradas/i)).toBeInTheDocument()
})

it('mostra resumo compacto e gráfico de linha com pontos classificados', async () => {
  await db.glucose.bulkAdd([stamp({ value: 115, at: minutesAgo(10) }), stamp({ value: 188, at: minutesAgo(20) }), stamp({ value: 345, at: minutesAgo(30) })])
  open('/relatorio')
  await screen.findByText('216 mg/dL')
  const chart = await screen.findByRole('img', { name: 'Gráfico de glicemia com 3 medições' })
  expect(chart.querySelector('polyline')).toBeInTheDocument()
  expect(chart.querySelectorAll('.glucose-chart-point')).toHaveLength(3)
  expect([...chart.querySelectorAll('.glucose-chart-point')].map(point => point.getAttribute('fill'))).toEqual(['#CE6872', '#D98A60', '#71AFA5'])
})

it('exibe detalhes reais ao selecionar pontos do gráfico e permite fechar o tooltip', async () => {
  const first = stamp({ value: 115, at: minutesAgo(20), context: 'Jejum' })
  const second = stamp({ value: 345, at: minutesAgo(10), context: 'Após refeição' })
  const third = stamp({ value: 160, at: minutesAgo(5) })
  await db.glucose.bulkAdd([first, second, third])
  open('/relatorio')
  const highPoint = await screen.findByRole('button', { name: /ver detalhes da medição de 345 mg\/dL/i })
  await userEvent.click(highPoint)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip).toHaveTextContent('345 mg/dL')
  expect(tooltip).toHaveTextContent(/\d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/)
  expect(tooltip).toHaveTextContent('Após refeição')
  expect(highPoint).toHaveAttribute('aria-pressed', 'true')

  const firstPoint = screen.getByRole('button', { name: /ver detalhes da medição de 115 mg\/dL/i })
  await userEvent.click(firstPoint)
  expect(screen.getByRole('tooltip')).toHaveTextContent('Jejum')
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('Após refeição')
  expect(firstPoint).toHaveAttribute('aria-pressed', 'true')

  await userEvent.click(screen.getByRole('button', { name: /ver detalhes da medição de 160 mg\/dL/i }))
  expect(screen.getByRole('tooltip')).toHaveTextContent('160 mg/dL')
  expect(screen.getByRole('tooltip').querySelectorAll('span')).toHaveLength(1)

  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('tooltip')).toBeNull()
  await userEvent.click(firstPoint)
  fireEvent.pointerDown(document.body)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
})

it('limpa a seleção quando o filtro remove o ponto selecionado', async () => {
  await db.glucose.bulkAdd([
    stamp({ value: 115, at: new Date(Date.now() - 31 * 86400000).toISOString() }),
    stamp({ value: 160, at: minutesAgo(10) }),
  ])
  open('/relatorio?period=90')
  const oldPoint = await screen.findByRole('button', { name: /ver detalhes da medição de 115 mg\/dL/i })
  await userEvent.click(oldPoint)
  expect(screen.getByRole('tooltip')).toHaveTextContent('115 mg/dL')
  await userEvent.selectOptions(screen.getByLabelText('Período'), '7')
  await waitFor(() => expect(screen.queryByRole('button', { name: /ver detalhes da medição de 115 mg\/dL/i })).toBeNull())
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('exibe uma legenda compacta que reutiliza as cores dos pontos', async () => {
  await db.glucose.add(stamp({ value: 115, at: minutesAgo(10) }))
  open('/relatorio')
  expect(await screen.findByLabelText('Legenda de classificação da glicemia')).toBeInTheDocument()
  expect(screen.getByText('Menor que 54 mg/dL: Hipoglicemia nível 2')).toBeInTheDocument()
  expect(screen.getByText('80–130 mg/dL: Dentro da faixa definida')).toBeInTheDocument()
  expect(screen.getByText(/valor de cada ponto, não a linha/i)).toBeInTheDocument()
  expect(screen.getByText(/não substituem metas individualizadas/i)).toBeInTheDocument()
  const swatches = document.querySelectorAll<HTMLElement>('.glucose-legend-swatch')
  expect(swatches).toHaveLength(7)
  expect(swatches[3].style.backgroundColor).toBe('rgb(113, 175, 165)')
})

it('mantém o gráfico completo no Relatório sem exibi-lo na Home', async () => {
  await db.glucose.add(stamp({ value: 115, at: minutesAgo(10) }))
  const view = open('/')
  await screen.findByRole('heading', { name: /olá, teste/i })
  expect(screen.queryByRole('link', { name: /gráfico completo de evolução recente/i })).toBeNull()
  view.unmount()
  open('/relatorio')
  expect(await screen.findByRole('heading', { name: 'Glicemia' })).toBeInTheDocument()
  expect(document.getElementById('grafico-glicemia')).toBeInTheDocument()
  expect(await screen.findByRole('img', { name: 'Gráfico de glicemia com 1 medição' })).toBeInTheDocument()
})

it('reposiciona no topo ao mudar de tela, inclusive quando a URL recebe filtro', async () => {
  const scrollTo = vi.mocked(window.scrollTo)
  open('/')
  await screen.findByRole('heading', { name: /olá, teste/i })
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' }))

  scrollTo.mockClear()
  await userEvent.click(screen.getByRole('link', { name: 'Relatório' }))
  expect(await screen.findByRole('heading', { name: 'Relatório' })).toBeInTheDocument()
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' }))

  scrollTo.mockClear()
  await userEvent.click(screen.getByRole('link', { name: 'Histórico' }))
  expect(await screen.findByRole('heading', { name: 'Histórico' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Glicemias' }))
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' }))
})

it('leva ao topo ao tocar novamente na guia ativa e respeita destinos com âncora', async () => {
  const scrollTo = vi.mocked(window.scrollTo)
  open('/')
  await screen.findByRole('heading', { name: /olá, teste/i })
  scrollTo.mockClear()
  await userEvent.click(screen.getByRole('link', { name: 'Início' }))
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })

  scrollTo.mockClear()
  cleanup()
  open('/relatorio?period=30#grafico-glicemia')
  expect(await screen.findByRole('heading', { name: 'Glicemia' })).toBeInTheDocument()
  expect(scrollTo).not.toHaveBeenCalled()
})
