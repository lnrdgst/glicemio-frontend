import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, now, stamp } from './database/db'

const open = () => render(<MemoryRouter initialEntries={['/mais']}><App /></MemoryRouter>)
const label = 'Exportar desde a última consulta com o endocrinologista'
let create = vi.fn((_blob: Blob) => 'blob:synthetic'), download: ReturnType<typeof vi.spyOn>
beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests'); await Promise.all(db.tables.map(table => table.clear()))
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2027, 0, 14, 15))
  await db.profiles.put({ id: 'local', name: 'Sintético', createdAt: now(), updatedAt: now() })
  create = vi.fn((_blob: Blob) => 'blob:synthetic')
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn() })
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals() })
const readDownload = async () => {
  const blob = create.mock.calls.at(-1)![0] as Blob
  return JSON.parse(await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) }))
}

it('usa a consulta endocrinológica de outubro, ignora a oftalmológica de dezembro e permite escolher outra endocrinológica', async () => {
  const older = stamp({ at: new Date(2026, 8, 20, 14).toISOString(), attendanceType: 'endocrinologist' as const, attendanceConfirmed: true })
  const october = stamp({ at: new Date(2026, 9, 27, 14).toISOString(), attendanceType: 'endocrinologist' as const, attendanceConfirmed: true })
  const january = stamp({ at: new Date(2027, 0, 13, 14).toISOString(), attendanceType: 'endocrinologist' as const })
  await db.appointments.bulkAdd([older, october, january, stamp({ at: new Date(2026, 11, 1, 14).toISOString(), attendanceType: 'ophthalmologist', attendanceConfirmed: true }), stamp({ at: new Date(2027, 1, 1).toISOString(), attendanceType: 'endocrinologist', attendanceConfirmed: true }), stamp({ at: october.at, attendanceType: 'other', attendanceTypeOther: 'Endocrinologista', attendanceConfirmed: true })])
  const view = open(); const entry = await screen.findByRole('button', { name: label })
  await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry)
  const select = screen.getByLabelText('Consulta com o endocrinologista de referência')
  expect(select).toHaveValue(october.id); expect(select.querySelectorAll('option')).toHaveLength(2)
  expect(screen.getByText(/Referência: Endocrinologista/)).toHaveTextContent('27 de out. de 2026')
  expect(screen.getByText(/Período:/)).toHaveTextContent('00:00')
  expect(document.querySelector('input[type="date"]')).toBeNull()
  expect(create).not.toHaveBeenCalled()
  fireEvent.change(select, { target: { value: older.id } })
  fireEvent.click(screen.getByRole('button', { name: 'Baixar JSON para análise' }))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect(await screen.findByText(/Nenhum registro clínico no período/)).toBeInTheDocument()
  const exported = await readDownload()
  expect(exported.data.appointments.some((item: { id: string }) => item.id === older.id)).toBe(true)
  expect(exported.version).toBe(2); expect(Object.keys(exported.data)).toHaveLength(9)
  view.unmount(); await db.appointments.update(january.id, { attendanceConfirmed: true })
  open(); const again = await screen.findByRole('button', { name: label }); await waitFor(() => expect(again).toBeEnabled()); fireEvent.click(again)
  expect(screen.getByLabelText('Consulta com o endocrinologista de referência')).toHaveValue(january.id)
})

it('não usa outra especialidade quando não há endocrinológica elegível e mantém exportação completa', async () => {
  await db.appointments.add(stamp({ at: '2026-12-01T12:00:00Z', attendanceType: 'ophthalmologist', attendanceConfirmed: true }))
  open(); expect(await screen.findByText(/Nenhuma consulta com o endocrinologista tem comparecimento confirmado/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: label })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Exportar todos os dados' }))
  await waitFor(() => expect(download).toHaveBeenCalledOnce())
  expect((await readDownload()).data.appointments).toHaveLength(1)
})

it('invalida a referência alterada enquanto o painel está aberto e bloqueia exportação com órfãos', async () => {
  const reference = stamp({ at: '2026-10-27T12:00:00Z', attendanceType: 'endocrinologist' as const, attendanceConfirmed: true }); await db.appointments.add(reference)
  open(); const entry = await screen.findByRole('button', { name: label }); await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry)
  await act(async () => { await db.appointments.update(reference.id, { attendanceType: 'nutritionist' }) })
  expect(await screen.findByText(/A referência mudou/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Baixar JSON para análise' })).toBeDisabled()
  await act(async () => { await db.appointments.update(reference.id, { attendanceType: 'endocrinologist' }); await db.glucose.add(stamp({ at: reference.at, value: 120, mealId: 'ausente' })) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar JSON para análise' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Baixar JSON para análise' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('refeição inexistente')
  expect(download).not.toHaveBeenCalled()
})
