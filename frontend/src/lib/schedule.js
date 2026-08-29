const SOURCES = ['personal', 'ai']
const SOURCE_ORDER = { manual: 0, personal: 1, ai: 2 }

const routineById = state => new Map((state.routines || []).map(routine => [routine.id, routine]))
const weekdayOf = isoDate => new Date(`${isoDate}T12:00:00`).getDay()
const idsForDay = (week, weekday) => {
  const value = week?.[weekday]
  return (Array.isArray(value) ? value : [value]).filter(id => typeof id === 'string' && id)
}

function cleanSchedule(schedule, sourceType) {
  const week = {}
  Object.entries(schedule?.week || {}).forEach(([day, value]) => {
    const weekday = Number(day)
    const ids = (Array.isArray(value) ? value : [value]).filter(id => typeof id === 'string' && id)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !ids.length) return
    week[weekday] = ids.length === 1 ? ids[0] : ids
  })
  return {
    ...schedule,
    sourceType,
    planId: String(schedule?.planId || `legacy-${sourceType}`),
    version: Number(schedule?.version) || 1,
    active: schedule?.active !== false,
    week,
  }
}

function addToSchedule(schedules, sourceType, metadata, day, routineId) {
  const planId = String(metadata.planId || `legacy-${sourceType}`)
  const version = Number(metadata.version) || 1
  const index = schedules.findIndex(schedule => schedule.planId === planId && schedule.version === version)
  const base = index >= 0 ? schedules[index] : cleanSchedule({ sourceType, planId, version, label: metadata.label, active: true, week: {} }, sourceType)
  const existing = idsForDay(base.week, day)
  const ids = existing.includes(routineId) ? existing : [...existing, routineId]
  const next = { ...base, week: { ...base.week, [day]: ids.length === 1 ? ids[0] : ids } }
  return index >= 0
    ? schedules.map((schedule, scheduleIndex) => scheduleIndex === index ? next : schedule)
    : [...schedules, next]
}

export function normalizeScheduleState(state = {}) {
  const routines = routineById(state)
  const existing = state.sourceSchedules || {}
  let personal = (Array.isArray(existing.personal) ? existing.personal : []).map(schedule => cleanSchedule(schedule, 'personal'))
  let ai = (Array.isArray(existing.ai) ? existing.ai : []).map(schedule => cleanSchedule(schedule, 'ai'))
  const week = {}

  Object.entries(state.week || {}).forEach(([day, routineId]) => {
    const routine = routines.get(routineId)
    if (routine?._personalProgramId) {
      personal = addToSchedule(personal, 'personal', {
        planId: routine._personalProgramId,
        version: routine._personalVersion,
        label: routine._personalProgramName,
      }, Number(day), routineId)
    } else if (routine?._aiGenerated) {
      ai = addToSchedule(ai, 'ai', {
        planId: routine._aiPlanId || state.aiLastGeneration?.planId,
        version: routine._aiVersion || state.aiLastGeneration?.version,
        label: state.aiLastGeneration?.name,
      }, Number(day), routineId)
    } else if (routineId) week[day] = routineId
  })

  for (const item of Array.isArray(state.aiSchedule) ? state.aiSchedule : []) {
    const routine = routines.get(item?.routineId)
    if (!routine || !Number.isInteger(Number(item.day))) continue
    ai = addToSchedule(ai, 'ai', {
      planId: routine._aiPlanId || state.aiLastGeneration?.planId,
      version: routine._aiVersion || state.aiLastGeneration?.version,
      label: state.aiLastGeneration?.name,
    }, Number(item.day), item.routineId)
  }

  return {
    ...state,
    week,
    dayPlan: { ...(state.dayPlan || {}) },
    sourceSchedules: { ...existing, personal, ai },
  }
}

const matchesPreference = (preference, option) => {
  if (!preference || preference === 'rest') return false
  if (typeof preference === 'string') return preference === option.routineId
  return preference.routineId === option.routineId &&
    (!preference.sourceType || preference.sourceType === option.sourceType) &&
    (!preference.planId || preference.planId === option.planId) &&
    (!preference.version || Number(preference.version) === option.version)
}

function routineOptionsForWeekday(state, weekday, preference) {
  const routines = routineById(state)
  const options = []
  const manualId = state.week?.[weekday]
  const manual = routines.get(manualId)
  if (manual) options.push({ routineId: manual.id, routine: manual, sourceType: 'manual', planId: null, version: null, label: 'Manual' })

  for (const sourceType of SOURCES) {
    for (const schedule of state.sourceSchedules?.[sourceType] || []) {
      if (schedule?.active === false) continue
      for (const routineId of idsForDay(schedule.week, weekday)) {
        const routine = routines.get(routineId)
        if (!routine) continue
        options.push({
          routineId,
          routine,
          sourceType,
          planId: schedule.planId || null,
          version: Number(schedule.version) || 1,
          label: schedule.label || routine.name,
        })
      }
    }
  }

  const seen = new Set()
  return options
    .filter(option => {
      const key = `${option.sourceType}|${option.planId || ''}|${option.routineId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((option, index) => ({ ...option, preferred: matchesPreference(preference, option), _order: index }))
    .sort((left, right) => Number(right.preferred) - Number(left.preferred) || SOURCE_ORDER[left.sourceType] - SOURCE_ORDER[right.sourceType] || left._order - right._order)
    .map(({ _order, ...option }) => option)
}

export const scheduledRoutineOptionsForWeekday = (state = {}, weekday) => routineOptionsForWeekday(state, weekday, null)

export function scheduledRoutineOptions(state = {}, isoDate) {
  return routineOptionsForWeekday(state, weekdayOf(isoDate), state.dayPlan?.[isoDate])
}

export const schedulePreference = option => option && ({
  routineId: option.routineId,
  sourceType: option.sourceType,
  planId: option.planId,
  version: option.version,
})

export const activeSourceMetadata = selection => typeof selection === 'object' && selection
  ? {
      sourceType: selection.sourceType || 'manual',
      planId: selection.planId || null,
      version: Number(selection.version) || null,
    }
  : { sourceType: 'manual', planId: null, version: null }
