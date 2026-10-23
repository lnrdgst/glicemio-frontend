import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { App } from './App'
import { db, GlicopontoDB, now, stamp } from './database/db'
import { iso, localInput, time } from './shared/format'

const open = (route: string) => render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const changeDateTime = (value: string) => {
  const [date = '', time = ''] = value.split('T')
  change('Data', date); fireEvent.change(screen.getByLabelText(/^Hora(?: do início da refeição)?$/), { target: { value: time } })
}
const save = () => userEvent.click(screen.getByRole('button', { name: /Salvar registro de/ }))
const mealAt = async (value: string, kind = 'Almoço') => { const meal = stamp({ kind, at: iso(value) }); await db.meals.add(meal); return meal }
const workoutEndedAt = async (value: string) => { const workout = stamp({ activity: 'Caminhada', startedAt: iso('2026-10-14T13:00'), endedAt: iso(value) }); await db.workouts.add(workout); return workout }
const applied = async (key: string, dose: number, at: string, kind: 'Rápida' | 'Basal/lenta' = 'Rápida') => {
  const record = stamp({ kind, medicationId: key, medicationKey: key, medicationName: key === 'lispro' ? 'Lispro' : 'Glargina U100', dose, at: iso(at) })
  await db.insulin.add(record); return record
}
const fill = async (kind: string) => {
  if (kind === 'glicemia') change('Valor (mg/dL)', '123')
  if (kind === 'refeicao') change('Tipo de refeição', 'Almoço')
  if (kind === 'insulina') { change('Dose (UI)', '4.5'); await userEvent.click(screen.getByLabelText(/Confirmo que esta dose corresponde/)) }
  if (kind === 'treino') { change('Atividade', 'Caminhada'); change('Hora de início', '23:30') }
}

beforeEach(async () => {
  expect(db.name).toBe('glicoponto-tests')
  await Promise.all(db.tables.map(table => table.clear()))
  await db.profiles.put({ id: 'local', name: 'Pessoa de teste', createdAt: now(), updatedAt: now() })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('data e hora nativas separadas', () => {
  it.each([
    ['glicemia', 'Registrar glicemia', 'form-title-glicemia', 'form-save-glicemia'],
    ['refeicao', 'Registrar refeição', 'form-title-refeicao', 'form-save-refeicao'],
    ['insulina', 'Registrar insulina', 'form-title-insulina', 'form-save-insulina'],
    ['treino', 'Registrar treino', 'form-title-treino', 'form-save-treino'],
    ['consulta', 'Nova consulta', 'form-title-consulta', 'form-save-consulta'],
  ])('aplica a categoria visual em %s', async (kind, title, titleClass, saveClass) => {
    open(`/${kind}`)
    expect(await screen.findByRole('heading', { name: title })).toHaveClass(titleClass)
    expect(screen.getByRole('button', { name: /Salvar registro de/ })).toHaveClass('primary', 'form-save', saveClass)
  })

  it.each(['refeicao', 'glicemia', 'insulina'])('inicializa %s com a data e a hora locais atuais', kind => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-14T15:20:00.000Z'))
    const current = localInput().split('T')
    open(`/${kind}`)
    const date = screen.getByLabelText('Data'), time = screen.getByLabelText(kind === 'refeicao' ? 'Hora do início da refeição' : 'Hora')
    expect(date).toHaveAttribute('type', 'date'); expect(date).toHaveValue(current[0]); expect(date).toBeRequired()
    expect(time).toHaveAttribute('type', 'time'); expect(time).toHaveValue(current[1]); expect(time).toBeRequired()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  })

  it('mantém data e hora vazias no cadastro de consulta e exige ambas', async () => {
    open('/consulta')
    const date = screen.getByLabelText('Data') as HTMLInputElement
    const time = screen.getByLabelText('Hora') as HTMLInputElement
    expect(date).toHaveAttribute('type', 'date'); expect(date).toHaveValue(''); expect(date).toBeRequired()
    expect(time).toHaveAttribute('type', 'time'); expect(time).toHaveValue(''); expect(time).toBeRequired()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()

    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe a data da consulta.')
    expect(await db.appointments.count()).toBe(0)

    change('Data', '2026-10-11')
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o horário da consulta.')
    expect(await db.appointments.count()).toBe(0)
  })

  it('recupera a data e o horário persistidos ao editar uma consulta', async () => {
    const record = stamp({ at: iso('2026-10-11T21:45') })
    await db.appointments.add(record)
    open(`/consulta/${record.id}/editar`)
    expect(await screen.findByLabelText('Data')).toHaveValue('2026-10-11')
    expect(screen.getByLabelText('Hora')).toHaveValue('21:45')
  })

  it('edita e limpa data e hora independentemente sem perder o outro valor', () => {
    open('/refeicao')
    const initialTime = (screen.getByLabelText('Hora do início da refeição') as HTMLInputElement).value
    change('Data', '2026-10-11'); expect(screen.getByLabelText('Hora do início da refeição')).toHaveValue(initialTime)
    change('Hora do início da refeição', '21:45'); expect(screen.getByLabelText('Data')).toHaveValue('2026-10-11')
    change('Data', ''); expect(screen.getByLabelText('Hora do início da refeição')).toHaveValue('21:45')
    change('Data', '2026-10-12'); change('Hora do início da refeição', ''); expect(screen.getByLabelText('Data')).toHaveValue('2026-10-12')
    change('Hora do início da refeição', '00:15'); expect(screen.getByLabelText('Data')).toHaveValue('2026-10-12')
  })

  it('atualiza a sugestão de refeição pela hora e preserva uma escolha manual', async () => {
    open('/refeicao')
    change('Hora do início da refeição', '10:00'); expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Almoço')
    change('Hora do início da refeição', '16:30'); expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Lanche')
    change('Tipo de refeição', 'Outro'); change('Hora do início da refeição', '19:00')
    expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Outro')
    await save(); await screen.findByRole('status')
    expect((await db.meals.toArray())[0]).toMatchObject({ kind: 'Outro' })
  })

  it('preserva o tipo de uma refeição existente ao editar', async () => {
    const record = await mealAt('2026-10-11T16:30', 'Outro')
    open(`/refeicao/${record.id}/editar`)
    expect(await screen.findByLabelText('Tipo de refeição')).toHaveValue('Outro')
    change('Hora da refeição (referência não confirmada)', '19:00')
    expect(screen.getByLabelText('Tipo de refeição')).toHaveValue('Outro')
  })

  it.each([['refeicao', 'meals'], ['glicemia', 'glucose'], ['insulina', 'insulin'], ['consulta', 'appointments']])('persiste o horário efetivo retroativo de %s sem deslocar o horário local', async (kind, table) => {
    open(`/${kind}`); await fill(kind)
    changeDateTime('2026-10-11T21:45'); await save(); await screen.findByRole('status')
    const record = (await db.table(table).toArray())[0]
    expect(record.at).toBe(new Date(2026, 9, 11, 21, 45).toISOString())
    expect(localInput(record.at)).toBe('2026-10-11T21:45')
    // Confirme também o offset efetivo da data selecionada, sem fixar o fuso do dispositivo.
    expect(+new Date(record.at)).toBe(Date.UTC(2026, 9, 11, 21, 45) + new Date(2026, 9, 11, 21, 45).getTimezoneOffset() * 60000)
  })

  it('recupera refeição retroativa e mostra data/hora efetivas no Histórico sem alterar legados', async () => {
    const legacy = await mealAt('2026-10-10T08:00', 'Café da manhã')
    const view = open('/refeicao'); await fill('refeicao'); changeDateTime('2026-10-11T23:55')
    await save(); await screen.findByRole('status'); view.unmount()
    const reopened = new GlicopontoDB(db.name)
    try {
      expect(await reopened.meals.get(legacy.id)).toEqual(legacy)
      const recorded = (await reopened.meals.toArray()).find(x => x.id !== legacy.id)!
      expect(localInput(recorded.at)).toBe('2026-10-11T23:55')
      open('/historico')
      const row = (await screen.findByText(/Almoço/)).closest('.item') as HTMLElement
      expect(within(row).getByText(`${time(recorded.at)} · Almoço`)).toBeInTheDocument()
      expect(screen.getByText(/11\/10\/2026/)).toBeInTheDocument()
    } finally { reopened.close() }
  })

  it.each(['Data', 'Hora do início da refeição'])('impede salvar refeição com %s vazia, mantendo o campo restante', async label => {
    open('/refeicao'); await fill('refeicao'); changeDateTime('2026-10-11T21:45'); change(label, '')
    const input = screen.getByLabelText(label) as HTMLInputElement
    expect(input.validity.valueMissing).toBe(true)
    expect(screen.getByLabelText(label === 'Data' ? 'Hora do início da refeição' : 'Data')).toHaveValue(label === 'Data' ? '21:45' : '2026-10-11')
    await save(); expect(await db.meals.count()).toBe(0)
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('data e um horário válidos')
    expect(await db.meals.count()).toBe(0)
  })

  it('recalcula contexto e revoga associação de glicemia quando a data é editada', async () => {
    await mealAt('2026-10-11T12:00'); open('/glicemia'); changeDateTime('2026-10-11T13:00')
    await userEvent.click(await screen.findByLabelText('Associar esta medição à refeição'))
    change('Data', '2026-10-12')
    expect(screen.getByLabelText('Hora')).toHaveValue('13:00'); expect(screen.getByLabelText('Contexto')).toHaveValue('Não informado')
    change('Data', '2026-10-11')
    expect(screen.getByLabelText('Associar esta medição à refeição')).not.toBeChecked()
  })
})

describe('campos numéricos', () => {
  it('solicita teclado numérico e rejeita glicemia não inteira, inclusive colada', async () => {
    open('/glicemia')
    const input = screen.getByLabelText('Valor (mg/dL)') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('pattern', '[0-9]*')
    expect(input).toHaveAttribute('enterkeyhint', 'next')

    for (const invalid of ['', '71+2', '71.5', 'setenta']) {
      change('Valor (mg/dL)', invalid)
      expect(invalid ? input.validity.patternMismatch : input.validity.valueMissing).toBe(true)
      fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
      expect(await screen.findByRole('alert')).toHaveTextContent('glicemia inteira maior que zero')
    }
    expect(await db.glucose.count()).toBe(0)

    change('Valor (mg/dL)', '71')
    await save()
    expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    expect((await db.glucose.toArray())[0]?.value).toBe(71)
  })

  it('aceita dose decimal com vírgula, sem arredondar, e rejeita formato inválido', async () => {
    open('/insulina')
    const input = screen.getByLabelText('Dose (UI)') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    expect(input).toHaveAttribute('pattern', '[0-9]+([,.][0-9]+)?')
    expect(input).toHaveAttribute('enterkeyhint', 'next')

    change('Dose (UI)', '4+5')
    expect(input.validity.patternMismatch).toBe(true)
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('dose válida maior que zero')
    expect(await db.insulin.count()).toBe(0)

    change('Dose (UI)', '4,25')
    expect(screen.getByRole('button', { name: /Salvar registro de/ })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('confirme que a dose corresponde')
    await userEvent.click(screen.getByLabelText(/Confirmo que esta dose corresponde/))
    await save()
    expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    expect((await db.insulin.toArray())[0]?.dose).toBe(4.25)
  })
})

describe('persistência dos formulários', () => {
  it('salva tipo de atendimento e texto de outro sem invalidar consultas legadas', async () => {
    const legacy = stamp({ at: iso('2026-10-20T09:00'), professional: 'Profissional legado' })
    await db.appointments.add(legacy)
    open('/consulta')
    changeDateTime('2026-10-20T09:00')
    change('Tipo de atendimento', 'other')
    change('Informe o tipo de atendimento', 'Fisioterapeuta')
    change('Nome do profissional (opcional)', 'Ana')
    await save()
    await screen.findByRole('status')
    const appointments = await db.appointments.toArray()
    expect(appointments).toHaveLength(2)
    const created = appointments.find(record => record.id !== legacy.id)!
    expect(created).toMatchObject({ attendanceType: 'other', attendanceTypeOther: 'Fisioterapeuta', professional: 'Ana' })
    expect(await db.appointments.get(legacy.id)).toEqual(legacy)
    cleanup()
    open(`/consulta/${created.id}/editar`)
    expect(await screen.findByLabelText('Tipo de atendimento')).toHaveValue('other')
    expect(screen.getByLabelText('Informe o tipo de atendimento')).toHaveValue('Fisioterapeuta')
  })

  it.each(['general', 'endocrinologist', 'nutritionist', 'ophthalmologist'] as const)('recupera o tipo de atendimento %s ao reabrir a edição', async attendanceType => {
    const appointment = stamp({ at: iso('2026-10-20T09:00'), attendanceType })
    await db.appointments.add(appointment)
    open(`/consulta/${appointment.id}/editar`)
    expect(await screen.findByLabelText('Tipo de atendimento')).toHaveValue(attendanceType)
  })

  it.each([['glicemia', 'glucose'], ['refeicao', 'meals'], ['insulina', 'insulin'], ['treino', 'workouts']])('salva %s, atualiza Home/Histórico e recupera após reabrir', async (kind, table) => {
    const view = open(`/${kind}`); await fill(kind); await save()
    expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    const records = await db.table(table).toArray(); expect(records).toHaveLength(1)
    if (kind === 'glicemia') expect(await screen.findByText('123')).toBeInTheDocument()
    if (kind === 'insulina') expect((await screen.findAllByRole('link', { name: /Registrar insulina/ })).some(link => link.classList.contains('home-add-insulin'))).toBe(true)
    if (kind === 'refeicao') expect(await screen.findByText('Almoço')).toBeInTheDocument()
    if (kind === 'treino') expect(await screen.findByText('Caminhada')).toBeInTheDocument()
    view.unmount()
    const reopened = new GlicopontoDB(db.name)
    try { expect(await reopened.table(table).toArray()).toEqual(records) } finally { reopened.close() }
    open('/historico')
    expect(await screen.findByRole('link', { name: /Detalhes|mg\/dL|Almoço|Insulina|Treino/ })).toBeInTheDocument()
  })
  it.each([['glicemia', 'glucose'], ['refeicao', 'meals'], ['insulina', 'insulin'], ['treino', 'workouts']])('mostra falha de %s, mantém os dados e permite tentar novamente', async (kind, table) => {
    const spy = vi.spyOn(db[table as 'glucose' | 'meals' | 'insulin' | 'workouts'], kind === 'refeicao' ? 'put' : 'add').mockRejectedValueOnce(new Error('QuotaExceededError'))
    open(`/${kind}`); await fill(kind); await save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar')
    expect(screen.queryByRole('status')).toBeNull()
    expect(await db.table(table).count()).toBe(0)
    expect(screen.getByRole('button', { name: /Salvar registro de/ })).toBeEnabled()
    await save(); expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('bloqueia submissões repetidas e só anuncia sucesso após a gravação', async () => {
    let release!: () => void
    const original = db.meals.put.bind(db.meals)
    const spy = vi.spyOn(db.meals, 'put').mockImplementation(record => Dexie.Promise.resolve(Dexie.waitFor(new Dexie.Promise<void>(resolve => { release = resolve }))).then(() => original(record)))
    open('/refeicao'); await fill('refeicao')
    const form = screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1)); expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled()
    await act(async () => release())
    expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    expect(await db.meals.count()).toBe(1)
  })
  it('salva no ambiente sem randomUUID, preservando o perfil', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    open('/refeicao'); await fill('refeicao'); await save()
    expect(await screen.findByRole('status')).toHaveTextContent('Registro salvo')
    expect((await db.profiles.get('local'))?.name).toBe('Pessoa de teste')
  })
  it('apresenta erro de data inválida sem salvar nem navegar', async () => {
    open('/glicemia'); await fill('glicemia'); changeDateTime('')
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('data e um horário válidos')
    expect(await db.glucose.count()).toBe(0)
  })
})

describe('glicemia contextual', () => {
  it('sugere o acontecimento concluído mais recente e preserva o contexto escolhido manualmente', async () => {
    await mealAt('2026-10-14T15:00'); await workoutEndedAt('2026-10-14T14:00')
    open('/glicemia'); changeDateTime('2026-10-14T16:00')
    await waitFor(() => expect(screen.getByLabelText('Contexto')).toHaveValue('Após refeição'))
    await workoutEndedAt('2026-10-14T15:30')
    await waitFor(() => expect(screen.getByLabelText('Contexto')).toHaveValue('Após treino'))
    change('Contexto', 'Jejum'); change('Hora', '17:00')
    expect(screen.getByLabelText('Contexto')).toHaveValue('Jejum')
  })
  it('pré-seleciona após refeição e associa somente a mais recente confirmada', async () => {
    await mealAt('2026-10-14T11:00', 'Lanche'); const latest = await mealAt('2026-10-14T12:00')
    open('/glicemia'); changeDateTime('2026-10-14T13:00')
    await waitFor(() => expect(screen.getByLabelText('Contexto')).toHaveValue('Após refeição'))
    await userEvent.click(screen.getByLabelText('Associar esta medição à refeição')); await fill('glicemia'); await save()
    await screen.findByRole('status'); expect((await db.glucose.toArray())[0]).toMatchObject({ context: 'Após refeição', mealId: latest.id })
  })
  it('permite ignorar a associação sem impedir o salvamento', async () => {
    await mealAt('2026-10-14T12:00'); open('/glicemia'); changeDateTime('2026-10-14T13:00')
    await screen.findByLabelText('Associar esta medição à refeição'); await fill('glicemia'); await save(); await screen.findByRole('status')
    expect((await db.glucose.toArray())[0]).toMatchObject({ context: 'Após refeição', mealId: undefined })
  })
  it.each(['ausente', 'fora da janela', 'futura'])('não infere jejum quando a refeição está %s', async situation => {
    if (situation !== 'ausente') await mealAt(situation === 'futura' ? '2026-10-14T14:00' : '2026-10-14T09:59')
    open('/glicemia'); changeDateTime('2026-10-14T13:00')
    await waitFor(() => expect(screen.getByLabelText('Contexto')).toHaveValue('Não informado'))
    expect(screen.queryByLabelText('Associar esta medição à refeição')).toBeNull()
  })
  it('mantém jejum selecionado manualmente após mudar o horário', async () => {
    await mealAt('2026-10-14T12:00'); open('/glicemia'); change('Contexto', 'Jejum'); changeDateTime('2026-10-14T13:00')
    await fill('glicemia'); await save(); await screen.findByRole('status')
    expect((await db.glucose.toArray())[0]).toMatchObject({ context: 'Jejum', mealId: undefined })
  })
  it('recalcula a sugestão e revoga a confirmação ao alterar o horário', async () => {
    await mealAt('2026-10-14T12:00'); open('/glicemia'); changeDateTime('2026-10-14T13:00')
    await userEvent.click(await screen.findByLabelText('Associar esta medição à refeição'))
    change('Hora', '13:30'); expect(screen.getByLabelText('Associar esta medição à refeição')).not.toBeChecked()
    change('Hora', '15:01'); expect(screen.getByLabelText('Contexto')).toHaveValue('Não informado')
    change('Hora', '15:00'); expect(screen.getByLabelText('Contexto')).toHaveValue('Após refeição')
  })
  it('limita opções elegíveis, recalcula pelo horário e preserva vínculo antigo na edição', async () => {
    open('/glicemia'); change('Contexto', 'Após refeição')
    const empty = screen.getByLabelText('Associar a uma refeição (opcional)')
    expect(within(empty).getAllByRole('option')).toHaveLength(1)
    cleanup()
    const oldest = await mealAt('2026-10-14T08:00', 'Antiga'); const second = await mealAt('2026-10-14T09:00', 'Segunda'); const third = await mealAt('2026-10-14T10:00', 'Terceira'); const newest = await mealAt('2026-10-14T11:00', 'Mais recente'); await mealAt('2026-10-14T14:00', 'Futura')
    open('/glicemia'); changeDateTime('2026-10-14T12:00'); change('Contexto', 'Após refeição')
    const select = screen.getByLabelText('Associar a uma refeição (opcional)')
    await waitFor(() => expect(within(select).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', newest.id, third.id, second.id]))
    change('Hora', '10:30')
    await waitFor(() => expect(within(select).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', third.id, second.id, oldest.id]))
    cleanup()
    const glucose = stamp({ value: 115, at: iso('2026-10-14T12:00'), context: 'Após refeição', mealId: oldest.id }); await db.glucose.add(glucose)
    open(`/glicemia/${glucose.id}/editar`)
    const editSelect = await screen.findByLabelText('Associar a uma refeição (opcional)')
    await waitFor(() => expect(editSelect).toHaveValue(oldest.id))
    expect(within(editSelect).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', newest.id, third.id, second.id, oldest.id])
  })
})

describe('insulina', () => {
  it('filtra o catálogo por categoria e mostra a classe correta', async () => {
    open('/insulina'); change('Insulina utilizada (opcional)', 'regular'); expect(screen.getByText('Classe: Humana de ação curta')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /NPH/ })).toBeNull()
    change('Tipo', 'Basal/lenta'); change('Insulina utilizada (opcional)', 'nph'); expect(screen.getByText('Classe: Humana de ação intermediária')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Lispro/ })).toBeNull()
  })
  it('pré-seleciona preferências habituais por categoria sem alterar o perfil após uma escolha manual', async () => {
    await db.profiles.update('local', { basalUsage: 'yes', basalMedicationId: 'glargine-u100-basaglar', rapidUsage: 'yes', rapidMedicationId: 'aspart-novorapid' })
    open('/insulina')
    await waitFor(() => expect(screen.getByLabelText('Insulina utilizada (opcional)')).toHaveValue('aspart-novorapid'))
    expect(screen.getByText('Pré-selecionada conforme sua preferência habitual.')).toBeInTheDocument()
    change('Tipo', 'Basal/lenta')
    await waitFor(() => expect(screen.getByLabelText('Insulina utilizada (opcional)')).toHaveValue('glargine-u100-basaglar'))
    change('Insulina utilizada (opcional)', 'nph')
    await fill('insulina'); await save(); await screen.findByRole('status')
    expect(await db.profiles.get('local')).toMatchObject({ basalMedicationId: 'glargine-u100-basaglar', rapidMedicationId: 'aspart-novorapid' })
  })
  it('usa o último medicamento da mesma categoria quando não há preferência configurada', async () => {
    await applied('lispro', 4, '2026-10-13T12:00')
    open('/insulina')
    await waitFor(() => expect(screen.getByLabelText('Insulina utilizada (opcional)')).toHaveValue('lispro'))
    expect(screen.getByText('Pré-selecionada conforme a última aplicação registrada desta categoria.')).toBeInTheDocument()
  })
  it('preserva nome livre e identidade estável de Outra', async () => {
    open('/insulina'); change('Insulina utilizada (opcional)', 'other'); change('Nome da insulina', '  Marca   Pessoal  ')
    await fill('insulina'); await save(); await screen.findByRole('status')
    expect((await db.insulin.toArray())[0]).toMatchObject({ medicationId: 'other', medicationName: 'Marca Pessoal', medicationKey: 'other:marca pessoal' })
  })
  it('recupera a última dose da mesma insulina por horário efetivo e exige confirmação antes de salvar', async () => {
    const old = await applied('lispro', 2, '2026-10-12T12:00')
    const latest = await applied('lispro', 4, '2026-10-13T12:00')
    await db.insulin.update(old.id, { createdAt: '2026-10-14T22:00:00.000Z' })
    await applied('aspart', 9, '2026-10-14T12:00')
    open('/insulina'); const newDate = (screen.getByLabelText('Data') as HTMLInputElement).value; const newTime = (screen.getByLabelText('Hora') as HTMLInputElement).value
    change('Insulina utilizada (opcional)', 'lispro')
    await userEvent.click(await screen.findByRole('button', { name: 'Preencher com dose anterior' }))
    expect(screen.getByLabelText('Dose (UI)')).toHaveValue('4')
    expect(screen.getByLabelText('Confirmo que esta dose corresponde à quantidade efetivamente aplicada.')).not.toBeChecked()
    expect(screen.getByLabelText('Data')).toHaveValue(newDate); expect(screen.getByLabelText('Hora')).toHaveValue(newTime)
    expect(screen.getByRole('button', { name: /Salvar registro de/ })).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirme que esta dose corresponde à quantidade efetivamente aplicada.')
    expect(await db.insulin.count()).toBe(3)
    await userEvent.click(screen.getByLabelText(/Confirmo que esta dose corresponde/)); change('Dose (UI)', '5'); expect(screen.getByLabelText(/Confirmo que esta dose corresponde/)).not.toBeChecked(); await userEvent.click(screen.getByLabelText(/Confirmo que esta dose corresponde/)); await save(); await screen.findByRole('status')
    expect(await db.insulin.get(latest.id)).toEqual(latest)
    expect((await db.insulin.toArray()).find(x => x.dose === 5)?.medicationKey).toBe('lispro')
  })
  it('limpa dose e confirmação ao trocar de medicamento sem histórico', async () => {
    await applied('lispro', 4, '2026-10-13T12:00'); open('/insulina'); change('Insulina utilizada (opcional)', 'lispro')
    await userEvent.click(await screen.findByRole('button', { name: 'Preencher com dose anterior' }))
    await userEvent.click(screen.getByLabelText(/Confirmo que esta dose corresponde/)); change('Insulina utilizada (opcional)', 'aspart')
    expect(screen.getByLabelText('Dose (UI)')).toHaveValue(''); expect(screen.getByLabelText(/Confirmo que esta dose corresponde/)).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Preencher com dose anterior' })).toBeNull()
  })
  it('permite associação opcional da rápida e remove a pendente ao mudar para basal', async () => {
    const meal = await mealAt('2026-10-14T12:00'); open('/insulina')
    await waitFor(() => expect(screen.getAllByRole('option').some(x => x.getAttribute('value') === meal.id)).toBe(true))
    change('Associar a uma refeição (opcional)', meal.id); change('Tipo', 'Basal/lenta')
    expect(screen.queryByLabelText('Associar a uma refeição (opcional)')).toBeNull()
    change('Tipo', 'Rápida'); expect(screen.getByLabelText('Associar a uma refeição (opcional)')).toHaveValue('')
    change('Tipo', 'Basal/lenta'); await fill('insulina'); await save(); await screen.findByRole('status')
    expect((await db.insulin.toArray())[0]).toMatchObject({ kind: 'Basal/lenta', mealId: undefined })
  })
  it('salva a associação confirmada pela seleção para rápida', async () => {
    const meal = await mealAt('2026-10-14T12:00'); open('/insulina')
    await waitFor(() => expect(screen.getAllByRole('option').some(x => x.getAttribute('value') === meal.id)).toBe(true))
    change('Associar a uma refeição (opcional)', meal.id); await fill('insulina'); await save(); await screen.findByRole('status')
    expect((await db.insulin.toArray())[0]?.mealId).toBe(meal.id)
  })
  it.each([0, 1, 2, 3])('lista somente Sem associação e as %s refeições recentes disponíveis', async count => {
    for (let index = 0; index < count; index += 1) await mealAt(`2026-10-${String(10 + index).padStart(2, '0')}T12:00`, `Refeição ${index + 1}`)
    open('/insulina')
    const select = await screen.findByLabelText('Associar a uma refeição (opcional)')
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(count + 1))
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('Sem associação')
  })
  it('limita a três refeições por horário efetivo e preserva a associação antiga na edição', async () => {
    const oldest = await mealAt('2026-10-10T12:00', 'Antiga')
    const second = await mealAt('2026-10-11T12:00', 'Segunda')
    const third = await mealAt('2026-10-12T12:00', 'Terceira')
    const newest = await mealAt('2026-10-13T12:00', 'Mais recente')
    await mealAt('2026-10-14T14:00', 'Futura')
    open('/insulina'); changeDateTime('2026-10-14T12:00')
    const createSelect = await screen.findByLabelText('Associar a uma refeição (opcional)')
    await waitFor(() => expect(within(createSelect).getAllByRole('option')).toHaveLength(4))
    expect(within(createSelect).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', newest.id, third.id, second.id])
    expect(within(createSelect).queryByRole('option', { name: /Antiga/ })).toBeNull()
    changeDateTime('2026-10-11T12:00')
    await waitFor(() => expect(within(createSelect).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', second.id, oldest.id]))
    cleanup()

    const insulin = stamp({ kind: 'Rápida' as const, dose: 4, at: iso('2026-10-14T12:00'), mealId: oldest.id })
    await db.insulin.add(insulin)
    open(`/insulina/${insulin.id}/editar`)
    const editSelect = await screen.findByLabelText('Associar a uma refeição (opcional)')
    await waitFor(() => expect(editSelect).toHaveValue(oldest.id))
    expect(within(editSelect).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['', newest.id, third.id, second.id, oldest.id])
    await userEvent.click(screen.getByRole('button', { name: /Salvar alterações (da|do)/ }))
    expect(await db.insulin.get(insulin.id)).toMatchObject({ mealId: oldest.id, dose: 4 })
  })
  it('mostra nomes, doses e horários reais independentes na Home', async () => {
    const basal = await applied('glargine-u100', 18, '2026-10-13T21:15', 'Basal/lenta')
    const rapid = await applied('lispro', 4, '2026-10-14T12:00')
    await db.glucose.add(stamp({ value: 115, at: iso('2026-10-14T13:00') }))
    open('/'); expect(await screen.findByText('Glargina U100')).toBeInTheDocument(); expect(screen.getByText('Lispro')).toBeInTheDocument()
    expect(screen.getByText('18 UI')).toBeInTheDocument(); expect(screen.getByText('4 UI')).toBeInTheDocument()
    expect(await db.insulin.get(basal.id)).toEqual(basal); expect(await db.insulin.get(rapid.id)).toEqual(rapid)
  })
})

describe('treino', () => {
  it('preenche as datas de hoje, mantém horários vazios e exige início', async () => {
    open('/treino'); expect(screen.getByLabelText('Data de início')).toHaveValue(localInput().slice(0, 10)); expect(screen.getByLabelText('Data de término')).toHaveValue(localInput().slice(0, 10))
    expect(screen.getByLabelText('Hora de início')).toHaveValue(''); expect(screen.getByLabelText('Hora de término (opcional)')).toHaveValue('')
    change('Atividade', 'Caminhada'); await save(); expect(await db.workouts.count()).toBe(0)
    fireEvent.submit(screen.getByRole('button', { name: /Salvar registro de/ }).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('horário válidos')
  })
  it('mostra sugestões ao focar, normaliza equivalências e aceita nova atividade', async () => {
    await db.workouts.bulkAdd(['  Musculação  ', 'musculacao', 'MUSCULAÇÃO'].map(activity => stamp({ activity, startedAt: now() })))
    await db.profiles.update('local', { workoutActivities: ['Natação', 'MUSCULACAO'] })
    open('/treino'); const input = screen.getByRole('combobox', { name: 'Atividade' }); await userEvent.click(input)
    expect(await screen.findByRole('option', { name: 'Musculação' })).toBeInTheDocument(); expect(screen.getAllByRole('option', { name: 'Musculação' })).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Natação' })).toBeInTheDocument()
    change('Atividade', 'musculacao'); expect(screen.getByRole('option', { name: 'Musculação' })).toBeInTheDocument()
    change('Atividade', '  Escalada   indoor  '); change('Hora de início', '08:15'); await save(); await screen.findByRole('status')
    expect((await db.workouts.toArray()).some(x => x.activity === 'Escalada indoor' && !x.endedAt)).toBe(true)
    expect((await db.workouts.toArray()).some(x => x.activity === '  Musculação  ')).toBe(true)
  })
  it('seleciona sugestão com teclado e Iniciar agora preenche horário explicitamente', async () => {
    await db.profiles.update('local', { workoutActivities: ['Natação'] }); open('/treino')
    await userEvent.click(screen.getByRole('combobox', { name: 'Atividade' })); await screen.findByRole('option', { name: 'Natação' })
    await userEvent.keyboard('{ArrowDown}{Enter}'); expect(screen.getByLabelText('Atividade')).toHaveValue('Natação')
    const openDailyWorkout = vi.spyOn(window, 'open').mockReturnValue(null)
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar agora' })); expect(screen.getByLabelText('Hora de início')).toHaveValue(localInput().slice(11))
    expect(openDailyWorkout).toHaveBeenCalledWith('https://daily-workout-cyan.vercel.app/', '_blank', 'noopener,noreferrer')
    expect(screen.queryByRole('link', { name: 'Abrir Daily Workout' })).toBeNull()
  })
  it('rejeita término anterior ao início sem persistir', async () => {
    open('/treino'); await fill('treino'); change('Hora de término (opcional)', '22:00'); await save()
    expect(await screen.findByRole('alert')).toHaveTextContent('término não pode anteceder'); expect(await db.workouts.count()).toBe(0)
  })
  it('salva treino que atravessa meia-noite e calcula duração local corretamente', async () => {
    open('/treino'); await fill('treino'); change('Data de início', '2026-10-14'); change('Data de término', '2026-10-15'); change('Hora de término (opcional)', '00:30')
    expect(screen.getByText('Duração: 60 min')).toBeInTheDocument(); await save(); await screen.findByRole('status')
    const record = (await db.workouts.toArray())[0]; expect(record.startedAt).toBe(iso('2026-10-14T23:30')); expect(record.endedAt).toBe(iso('2026-10-15T00:30'))
  })
})
