import crypto from 'node:crypto';

export const AI_PROVIDERS = ['openai', 'gemini', 'anthropic'];

export const AI_EXERCISES = [
  { id: '0025', name: 'Supino reto com barra', bp: 'chest', eq: 'barbell' },
  { id: '0047', name: 'Supino inclinado com halteres', bp: 'chest', eq: 'dumbbell' },
  { id: '0334', name: 'Crucifixo no cabo', bp: 'chest', eq: 'cable' },
  { id: '0251', name: 'Triceps na polia', bp: 'upper arms', eq: 'cable' },
  { id: '0241', name: 'Desenvolvimento com halteres', bp: 'shoulders', eq: 'dumbbell' },
  { id: '0027', name: 'Remada curvada com barra', bp: 'back', eq: 'barbell' },
  { id: '0007', name: 'Puxada na polia', bp: 'back', eq: 'cable' },
  { id: '0031', name: 'Rosca direta com barra', bp: 'upper arms', eq: 'barbell' },
  { id: '1323', name: 'Remada sentada no cabo', bp: 'back', eq: 'cable' },
  { id: '0043', name: 'Agachamento com barra', bp: 'upper legs', eq: 'barbell' },
  { id: '0085', name: 'Leg press', bp: 'upper legs', eq: 'leverage machine' },
  { id: '0739', name: 'Cadeira extensora', bp: 'upper legs', eq: 'leverage machine' },
  { id: '0585', name: 'Mesa flexora', bp: 'upper legs', eq: 'leverage machine' },
  { id: '0605', name: 'Panturrilha em pe', bp: 'lower legs', eq: 'leverage machine' },
  { id: '0001', name: 'Abdominal curto', bp: 'waist', eq: 'body weight' },
  { id: '0003', name: 'Bicicleta no solo', bp: 'waist', eq: 'body weight' },
  { id: '1311', name: 'Flexao de braco', bp: 'chest', eq: 'body weight' },
  { id: '1429', name: 'Barra fixa pegada aberta', bp: 'back', eq: 'body weight' },
  { id: '2363', name: 'Mergulho nas paralelas', bp: 'chest', eq: 'body weight' },
  { id: '0852', name: 'Agachamento com peso', bp: 'upper legs', eq: 'weighted' },
  { id: '0846', name: 'Russian twist com peso', bp: 'waist', eq: 'weighted' },
  { id: '0853', name: 'Rosca com peso', bp: 'upper arms', eq: 'weighted' },
  { id: '0036', name: 'Bicicleta ergometrica', bp: 'cardio', eq: 'stationary bike' },
  { id: '0501', name: 'Esteira', bp: 'cardio', eq: 'cardio machine' }
];

const text = (value, max = 180) => String(value || '').trim().slice(0, max);
const int = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

export const WORKOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'summary', 'routines', 'week'],
  properties: {
    name: { type: 'string' },
    summary: { type: 'string' },
    routines: {
      type: 'array',
      minItems: 1,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'ex'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          ex: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'sets', 'reps', 'rest', 'note'],
              properties: {
                id: { type: 'string' },
                sets: { type: 'integer', minimum: 1, maximum: 8 },
                reps: { type: 'string' },
                rest: { type: 'integer', minimum: 30, maximum: 300 },
                note: { type: 'string' }
              }
            }
          }
        }
      }
    },
    week: {
      type: 'array',
      minItems: 1,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'routineId'],
        properties: {
          day: { type: 'integer', minimum: 0, maximum: 6 },
          routineId: { type: 'string' }
        }
      }
    }
  }
};

export function missingAiFields(state) {
  const profile = state?.aiProfile || {};
  const latestWeight = [...(state?.bodyweight || [])].sort((a, b) => String(b.d).localeCompare(String(a.d)))[0];
  const missing = [];
  if (!latestWeight?.w) missing.push('peso');
  if (!profile.heightCm) missing.push('altura');
  if (!text(profile.goal)) missing.push('objetivo');
  if (!Array.isArray(profile.equipment) || !profile.equipment.length) missing.push('aparelhos');
  return missing;
}

export function candidateExercises(profile = {}, catalogue = AI_EXERCISES) {
  const allowed = new Set((profile.equipment || []).map(item => String(item).toLowerCase()));
  const bodyWeightAllowed = allowed.size === 0 || allowed.has('body weight') || allowed.has('peso corporal');
  const rows = catalogue.filter(exercise => allowed.size === 0 || allowed.has(exercise.eq) || (exercise.eq === 'body weight' && bodyWeightAllowed));
  const ranked = rows.length ? rows : catalogue.filter(exercise => exercise.eq === 'body weight');
  return ranked.slice(0, 48);
}

export function buildWorkoutPrompt({ state, profile, candidates, generatedAt }) {
  const latestWeight = [...(state.bodyweight || [])].sort((a, b) => String(b.d).localeCompare(String(a.d)))[0] || null;
  const payload = {
    generatedAt,
    aluno: {
      unidade: state.unit || 'kg',
      pesoAtualKg: latestWeight?.w || null,
      alturaCm: profile.heightCm || null,
      objetivo: text(profile.goal),
      experiencia: profile.experience || 'intermediario',
      sessoesPorSemana: int(profile.sessionsPerWeek, 2, 7, 4),
      minutosPorSessao: int(profile.minutesPerSession, 25, 120, 60),
      restricoes: text(profile.limitations, 260),
      preferencias: text(profile.preferences, 260),
      aparelhosFavoritos: (profile.favoriteEquipment || []).slice(0, 8)
    },
    aparelhosDisponiveis: [...new Set(candidates.map(item => item.eq))],
    exerciciosPermitidos: candidates.map(item => ({ id: item.id, nome: item.name, grupo: item.bp, aparelho: item.eq }))
  };
  return [
    '# Pedido de treino semanal',
    'Crie uma semana de treino segura e objetiva em pt-BR.',
    'Use SOMENTE IDs de exerciciosPermitidos. Nao invente IDs.',
    'Distribua dias em week como lista de objetos {day,routineId}; use 0=domingo ... 6=sabado.',
    'Retorne apenas o JSON do schema.',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```'
  ].join('\n');
}

export function normalizeAiWorkout(plan, candidates) {
  const allowed = new Set(candidates.map(item => item.id));
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.routines)) throw new Error('invalid workout');
  const routines = plan.routines.slice(0, 7).map((routine, index) => ({
    id: text(routine.id, 60) || `ia-${index + 1}`,
    name: text(routine.name, 80) || `Treino IA ${index + 1}`,
    emoji: routine.emoji || 'sparkles',
    _aiGenerated: true,
    _aiSummary: text(plan.summary, 240),
    ex: (Array.isArray(routine.ex) ? routine.ex : []).slice(0, 10).map(exercise => {
      const id = text(exercise.id, 40);
      if (!allowed.has(id)) throw new Error(`exercise ${id || '?'} is not allowed`);
      return {
        id,
        sets: int(exercise.sets, 1, 8, 3),
        reps: text(exercise.reps, 24) || '8-12',
        rest: int(exercise.rest, 30, 300, 90),
        weight: 0,
        note: text(exercise.note, 220)
      };
    }).filter(Boolean)
  })).filter(routine => routine.ex.length);
  if (!routines.length) throw new Error('empty workout');
  const routineIds = new Set(routines.map(item => item.id));
  const weekEntries = Array.isArray(plan.week)
    ? plan.week.map(item => [String(item.day), item.routineId])
    : Object.entries(plan.week || {});
  const week = Object.fromEntries(weekEntries
    .filter(([day, routineId]) => /^[0-6]$/.test(day) && routineIds.has(routineId))
    .slice(0, 7));
  if (!Object.keys(week).length) {
    routines.forEach((routine, index) => { week[String((index + 1) % 7)] = routine.id; });
  }
  return { name: text(plan.name, 90) || 'Treino da semana com IA', summary: text(plan.summary, 300), routines, week };
}

export function applyAiWorkout(state, normalized, generatedAt) {
  const oldAi = new Set((state.routines || []).filter(item => item._aiGenerated).map(item => item.id));
  const routines = [
    ...(state.routines || []).filter(item => !oldAi.has(item.id)),
    ...normalized.routines.map(item => ({ ...item, _aiGeneratedAt: generatedAt, _aiPlanName: normalized.name }))
  ];
  const week = {
    ...Object.fromEntries(Object.entries(state.week || {}).filter(([, routineId]) => !oldAi.has(routineId))),
    ...normalized.week
  };
  return {
    ...state,
    routines,
    week,
    aiLastGeneration: { name: normalized.name, summary: normalized.summary, generatedAt }
  };
}

export function parseModelJson(response) {
  if (response && typeof response === 'object') return response;
  const source = String(response || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  return JSON.parse((fenced ? fenced[1] : source).trim());
}

export function encryptSecret(secret, value) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(secret, value) {
  const [iv, tag, ciphertext] = String(value || '').split('.');
  if (!iv || !tag || !ciphertext) return '';
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
