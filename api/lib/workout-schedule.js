const idsForDay = (week, weekday) => {
  const value = week?.[weekday];
  return (Array.isArray(value) ? value : [value]).filter(id => typeof id === 'string' && id);
};

export function scheduledOptionsForDay(state = {}, isoDate) {
  const weekday = new Date(`${isoDate}T12:00:00`).getDay();
  const routines = new Map((state.routines || []).map(routine => [routine.id, routine]));
  const candidates = [{ sourceType: 'manual', planId: null, routineId: state.week?.[weekday] }];
  for (const sourceType of ['personal', 'ai']) {
    for (const schedule of state.sourceSchedules?.[sourceType] || []) {
      if (schedule?.active === false) continue;
      idsForDay(schedule.week, weekday).forEach(routineId => candidates.push({ sourceType, planId: schedule.planId || null, routineId }));
    }
  }
  const seen = new Set();
  return candidates.flatMap(candidate => {
    const routine = routines.get(candidate.routineId);
    const key = `${candidate.sourceType}|${candidate.planId || ''}|${candidate.routineId}`;
    if (!routine || seen.has(key)) return [];
    seen.add(key);
    return [{ ...candidate, routine }];
  });
}

export function reminderForState(state, isoDate) {
  const options = scheduledOptionsForDay(state, isoDate);
  if (!options.length) return null;
  if (options.length === 1) {
    const routine = options[0].routine;
    return {
      optionCount: 1,
      title: `${routine.emoji || '🏋️'} ${routine.name} today`,
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder',
      data: { url: '#/workout' }
    };
  }
  return {
    optionCount: options.length,
    title: `Você tem ${options.length} sessões disponíveis`,
    body: 'Escolha qual treino iniciar.',
    tag: 'day-reminder',
    data: { url: '#/workout' }
  };
}
