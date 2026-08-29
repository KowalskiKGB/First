export const AI_EQUIPMENT = [
  ['body weight', 'Peso corporal'],
  ['barbell', 'Barra'],
  ['dumbbell', 'Halteres'],
  ['cable', 'Polia / cabo'],
  ['leverage machine', 'Máquinas articuladas'],
  ['weighted', 'Carga livre'],
  ['stationary bike', 'Bicicleta ergométrica'],
  ['cardio machine', 'Esteira / cardio']
];

export const AI_EXPERIENCE = [
  ['iniciante', 'Iniciante'],
  ['intermediario', 'Intermediário'],
  ['avancado', 'Avançado']
];

export function latestBodyWeight(state) {
  return [...(state.bodyweight || [])].sort((a, b) => String(b.d).localeCompare(String(a.d)))[0] || null;
}

export function aiProfile(state) {
  return {
    heightCm: '',
    goal: '',
    experience: 'intermediario',
    sessionsPerWeek: 4,
    minutesPerSession: 60,
    limitations: '',
    preferences: '',
    equipment: [],
    favoriteEquipment: [],
    ...(state.aiProfile || {})
  };
}

export function aiMissingFields(state) {
  const profile = aiProfile(state);
  const missing = [];
  if (!latestBodyWeight(state)?.w) missing.push('peso');
  if (!profile.heightCm) missing.push('altura');
  if (!String(profile.goal || '').trim()) missing.push('objetivo');
  if (!profile.equipment.length) missing.push('aparelhos');
  return missing;
}

export function equipmentLabel(value) {
  return AI_EQUIPMENT.find(([id]) => id === value)?.[1] || value;
}
