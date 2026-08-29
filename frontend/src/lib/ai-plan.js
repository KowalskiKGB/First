import { EXDB } from './exercises-data.js'

const EQUIPMENT_LABELS = {
  assisted: 'Assistido',
  band: 'Faixa elástica',
  barbell: 'Barra',
  'body weight': 'Peso corporal',
  'bosu ball': 'Bosu',
  cable: 'Polia / cabo',
  dumbbell: 'Halteres',
  'elliptical machine': 'Elíptico',
  'ez barbell': 'Barra EZ',
  hammer: 'Martelo',
  kettlebell: 'Kettlebell',
  'leverage machine': 'Máquinas articuladas',
  'medicine ball': 'Bola medicinal',
  'olympic barbell': 'Barra olímpica',
  'resistance band': 'Faixa de resistência',
  roller: 'Rolo',
  rope: 'Corda',
  'skierg machine': 'SkiErg',
  'sled machine': 'Trenó',
  'smith machine': 'Máquina Smith',
  'stability ball': 'Bola suíça',
  'stationary bike': 'Bicicleta ergométrica',
  'stepmill machine': 'Escada ergométrica',
  tire: 'Pneu',
  'trap bar': 'Trap bar',
  'upper body ergometer': 'Ergômetro de braços',
  weighted: 'Carga livre',
  'wheel roller': 'Roda abdominal'
}

const equipmentCounts = EXDB.reduce((acc, exercise) => {
  if (exercise.eq) acc[exercise.eq] = (acc[exercise.eq] || 0) + 1
  return acc
}, {})

export function equipmentLabel(value) {
  return EQUIPMENT_LABELS[value] || value
}

export const AI_EQUIPMENT = Object.keys(equipmentCounts)
  .sort((a, b) => equipmentCounts[b] - equipmentCounts[a] || equipmentLabel(a).localeCompare(equipmentLabel(b), 'pt-BR'))
  .map(id => [id, equipmentLabel(id), equipmentCounts[id]])

export const AI_TARGET_AREAS = [
  ['chest', 'Peito'],
  ['back', 'Costas'],
  ['shoulders', 'Ombros'],
  ['upper arms', 'Braços'],
  ['upper legs', 'Pernas'],
  ['lower legs', 'Panturrilhas'],
  ['waist', 'Core'],
  ['cardio', 'Cardio']
]

export const AI_EXPERIENCE = [
  ['iniciante', 'Iniciante'],
  ['intermediario', 'Intermediário'],
  ['avancado', 'Avançado']
]

export function latestBodyWeight(state) {
  return [...(state.bodyweight || [])].sort((a, b) => String(b.d).localeCompare(String(a.d)))[0] || null
}

export function aiProfile(state) {
  return {
    heightCm: '',
    goal: '',
    experience: 'intermediario',
    sessionsPerWeek: 4,
    minutesPerSession: 60,
    gymName: '',
    measurements: {},
    targetAreas: [],
    limitations: '',
    preferences: '',
    equipment: [],
    favoriteEquipment: [],
    favoriteExerciseIds: [],
    blockedExerciseIds: [],
    ...(state.aiProfile || {})
  }
}

export function aiMissingFields(state) {
  const profile = aiProfile(state)
  const missing = []
  if (!latestBodyWeight(state)?.w) missing.push('peso')
  if (!profile.heightCm) missing.push('altura')
  if (!String(profile.goal || '').trim()) missing.push('objetivo')
  if (!String(profile.gymName || '').trim()) missing.push('academia')
  if (!profile.equipment.length) missing.push('aparelhos')
  return missing
}
