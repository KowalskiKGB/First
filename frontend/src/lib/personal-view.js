import { todayFortaleza } from './personal-forms.js'

const PRIORITY_ORDER = Object.freeze({ urgent: 0, attention: 1, ok: 2 })
const STUDENT_TABS = new Set(['resumo', 'treino', 'evolucao', 'medidas', 'ia', 'agenda', 'financeiro'])

export const normalizeViewText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')

export function filterAndSortClients(clients, { query = '', status = 'all' } = {}) {
  const needle = normalizeViewText(query).trim()
  return (Array.isArray(clients) ? clients : [])
    .filter(client => status === 'all' || (client?.priority || 'ok') === status)
    .filter(client => !needle || normalizeViewText([
      client?.name,
      client?.goal,
      ...(Array.isArray(client?.reasons) ? client.reasons : []),
    ].join(' ')).includes(needle))
    .sort((a, b) => (PRIORITY_ORDER[a?.priority] ?? 2) - (PRIORITY_ORDER[b?.priority] ?? 2)
      || String(a?.name || '').localeCompare(String(b?.name || ''), 'pt-BR'))
}

export function buildDayTimeline(agenda = {}) {
  const appointments = (Array.isArray(agenda.today) ? agenda.today : []).map(item => ({
    ...item,
    kind: 'appointment',
  }))
  const openSlots = (Array.isArray(agenda.openSlots) ? agenda.openSlots : []).map(item => ({
    ...item,
    kind: 'open',
    status: 'open',
  }))
  return [...appointments, ...openSlots].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
}

export const normalizeStudentTab = tab => STUDENT_TABS.has(tab) ? tab : 'resumo'

export function measurementTrend(measurements, kind, side = null, limit = 12) {
  return (Array.isArray(measurements) ? measurements : [])
    .filter(item => item?.kind === kind && (side == null || item?.side === side))
    .sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)))
    .slice(-limit)
}

export function receivableDisplayStatus(receivable, today = todayFortaleza()) {
  if (receivable?.status === 'paid') return 'paid'
  if (receivable?.status === 'waived') return 'waived'
  return receivable?.status === 'open' && receivable?.dueOn < today ? 'overdue' : 'open'
}

export function formatTimeInZone(value, locale, timeZone = 'America/Fortaleza') {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Fortaleza',
    }).format(date)
  }
}

export function dateInTimeZone(value, timeZone = 'America/Fortaleza') {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  let parts
  try {
    parts = new Intl.DateTimeFormat('en', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Fortaleza',
    }).formatToParts(date)
  }
  const valueOf = type => parts.find(part => part.type === type)?.value || ''
  return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`
}

export function mutationErrorMessage(error) {
  if (error?.status === 403) return 'Permission revoked'
  if (error?.status === 409) return 'Data updated; keep this form open and repeat the action.'
  if (error?.message === 'schedule conflict') return 'This time overlaps another class. Choose another time.'
  if (error?.message === 'outside availability') return 'This time is outside your availability. Change the time or update your weekly availability.'
  return error?.message || 'Could not save changes'
}

export const appointmentStatusLabel = status => ({
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
  open: 'Open slot',
}[status] || 'Scheduled')

export const receivableStatusLabel = status => ({
  open: 'Open',
  overdue: 'Overdue',
  paid: 'Paid',
  waived: 'Waived',
}[status] || 'Open')

const REASON_LABELS = Object.freeze({
  'Pagamento vencido': 'Payment overdue',
  'Aula nas proximas 24h sem treino publicado': 'Class within 24 hours without a published program',
  'Aluno inativo': 'Student inactive beyond the configured limit',
  'Aderencia abaixo de 70%': 'Adherence below 70%',
  'Cobranca a vencer': 'Charge due within three days',
  'Em dia': 'Up to date',
})

export const priorityReasonLabels = client => (Array.isArray(client?.reasons) ? client.reasons : [])
  .filter(Boolean)
  .map(reason => REASON_LABELS[reason] || reason)

export const measurementKindLabel = kind => ({
  weight: 'Weight',
  waist: 'Waist',
  chest: 'Chest',
  hip: 'Hips',
  neck: 'Neck',
  arm: 'Arm',
  thigh: 'Thigh',
  calf: 'Calf',
  bodyFat: 'Body fat',
}[kind] || 'Measurement')

export function clientFinanceStatus(finance = {}) {
  if ((finance.overdueCents || 0) > 0) return 'overdue'
  if ((finance.openCents || 0) > 0) return 'open'
  if ((finance.expectedCents || 0) > 0 && (finance.receivedCents || 0) >= finance.expectedCents) return 'paid'
  if ((finance.expectedCents || 0) > 0) return 'waived'
  return 'none'
}

export const upcomingFromClients = clients => (Array.isArray(clients) ? clients : [])
  .flatMap(client => client?.nextAppointment ? [{ ...client.nextAppointment, clientName: client.name }] : [])
  .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
