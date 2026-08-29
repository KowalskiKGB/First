const PROGRAM_LIMITS = Object.freeze({ routines: 12, exercises: 30, name: 90, routineName: 80, note: 240 })
const BILATERAL_KINDS = new Set(['arm', 'thigh', 'calf'])
const MEASUREMENTS = Object.freeze({
  weight: { unit: 'kg', min: 20, max: 350 },
  waist: { unit: 'cm', min: 10, max: 250 },
  chest: { unit: 'cm', min: 10, max: 250 },
  hip: { unit: 'cm', min: 10, max: 250 },
  neck: { unit: 'cm', min: 10, max: 250 },
  arm: { unit: 'cm', min: 10, max: 250 },
  thigh: { unit: 'cm', min: 10, max: 250 },
  calf: { unit: 'cm', min: 10, max: 250 },
  bodyFat: { unit: '%', min: 1, max: 75 },
})

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const cleanText = (value, max) => String(value || '').trim().slice(0, max)
const clampInt = (value, min, max, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

export { BILATERAL_KINDS, MEASUREMENTS, PROGRAM_LIMITS }

export const normalizeSearchText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')

export function searchExerciseCatalog(catalogue, query, localizedName = exercise => exercise?.n || '') {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return catalogue
  return catalogue.filter(exercise => {
    const haystack = normalizeSearchText(`${exercise?.n || ''} ${localizedName(exercise) || ''}`)
    return terms.every(term => haystack.includes(term))
  })
}

function normalizeExercise(exercise) {
  const id = cleanText(exercise?.id, 100)
  if (!id) return null
  return {
    id,
    sets: clampInt(exercise.sets, 1, 20, 3),
    reps: clampInt(exercise.reps, 1, 999, 10),
    rest: clampInt(exercise.rest, 0, 1800, 60),
    note: cleanText(exercise.note, PROGRAM_LIMITS.note),
  }
}

function normalizeRoutine(routine, index) {
  const id = cleanText(routine?.id, 100) || `rotina-${index + 1}`
  const sourceExercises = Array.isArray(routine?.ex) ? routine.ex : Array.isArray(routine?.exercises) ? routine.exercises : []
  return {
    id,
    name: cleanText(routine?.name, PROGRAM_LIMITS.routineName) || `Rotina ${index + 1}`,
    ex: sourceExercises.slice(0, PROGRAM_LIMITS.exercises).map(normalizeExercise).filter(Boolean),
  }
}

export function normalizeProgram(program = {}) {
  const routines = (Array.isArray(program?.routines) ? program.routines : [])
    .slice(0, PROGRAM_LIMITS.routines)
    .map(normalizeRoutine)
  const routineIds = new Set(routines.map(routine => routine.id))
  const week = {}
  Object.entries(program?.week || {}).forEach(([day, routineId]) => {
    const weekday = Number(day)
    if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 && routineIds.has(routineId)) week[weekday] = routineId
  })
  const id = cleanText(program?.id, 100)
  return {
    ...(id ? { id } : {}),
    name: cleanText(program?.name, PROGRAM_LIMITS.name) || 'Treino do Personal',
    routines,
    week,
  }
}

export function reorderItem(items, from, to) {
  if (!Array.isArray(items) || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export function formatBRL(cents) {
  if (!Number.isSafeInteger(cents)) throw new TypeError('Centavos devem ser um inteiro')
  return brl.format(cents / 100)
}

export function reaisToCents(value) {
  const raw = String(value ?? '').trim()
  const grouped = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/
  const plain = /^\d+(?:[,.]\d{1,2})?$/
  if (!raw || (!grouped.test(raw) && !plain.test(raw))) throw new TypeError('Valor em reais inválido')
  const normalized = grouped.test(raw) ? raw.replaceAll('.', '').replace(',', '.') : raw.replace(',', '.')
  const [whole, decimal = ''] = normalized.split('.')
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) throw new TypeError('Valor em reais inválido')
  return cents
}

export function centsToReais(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return ''
  const whole = Math.floor(cents / 100)
  return `${whole},${String(cents % 100).padStart(2, '0')}`
}

function localParts(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''))
  if (!dateMatch || !timeMatch) throw new TypeError('Data ou hora inválida')
  const [, yearText, monthText, dayText] = dateMatch
  const [, hourText, minuteText] = timeMatch
  const parts = [yearText, monthText, dayText, hourText, minuteText].map(Number)
  const [year, month, day, hour, minute] = parts
  const calendar = new Date(Date.UTC(year, month - 1, day))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59) {
    throw new TypeError('Data ou hora inválida')
  }
  return { year, month, day, hour, minute }
}

export function fortalezaDateTime(date, time) {
  const { year, month, day, hour, minute } = localParts(date, time)
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute)).toISOString()
}

export function fortalezaInterval(date, time, durationMinutes) {
  const duration = Number(durationMinutes)
  if (![30, 45, 60, 90].includes(duration)) throw new TypeError('Duração inválida')
  const startsAt = fortalezaDateTime(date, time)
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + duration * 60000).toISOString() }
}

export function fortalezaFields(iso) {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return { date: '', time: '' }
  const local = new Date(timestamp - 3 * 3600000).toISOString()
  return { date: local.slice(0, 10), time: local.slice(11, 16) }
}

export function todayFortaleza(now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(timestamp)) throw new TypeError('Data inválida')
  return new Date(timestamp - 3 * 3600000).toISOString().slice(0, 10)
}

function decimalValue(value) {
  const raw = String(value ?? '').trim().replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new TypeError('Medida inválida')
  return Number(raw)
}

function validDate(date) {
  try {
    localParts(date, '00:00')
    return true
  } catch {
    return false
  }
}

export function measurementPayload(draft, today = todayFortaleza()) {
  const definition = MEASUREMENTS[draft?.kind]
  if (!definition) throw new TypeError('Tipo de medida inválido')
  if (!validDate(draft.observedAt) || draft.observedAt > today) throw new TypeError('Data inválida')
  const value = Math.round(decimalValue(draft.value) * 10) / 10
  if (value < definition.min || value > definition.max) throw new RangeError('Medida fora do intervalo')
  const side = BILATERAL_KINDS.has(draft.kind) ? draft.side : null
  if (BILATERAL_KINDS.has(draft.kind) && !['left', 'right'].includes(side)) throw new TypeError('Informe o lado')
  return {
    ...(draft.clientId ? { clientId: draft.clientId } : {}),
    kind: draft.kind,
    side,
    value,
    unit: definition.unit,
    observedAt: draft.observedAt,
  }
}
