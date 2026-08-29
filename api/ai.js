import crypto from 'node:crypto';
import { EXDB } from '../frontend/src/lib/exercises-data.js';
import ptNames from '../frontend/src/exercise-names/pt.js';

export const AI_PROVIDERS = ['openai', 'gemini', 'anthropic'];

export const AI_EXERCISES = EXDB.map(exercise => ({
  id: exercise.id,
  name: ptNames[exercise.id] || exercise.n,
  bp: exercise.bp,
  eq: exercise.eq,
  tg: exercise.tg
}));

export const AI_EQUIPMENT = [...new Set(AI_EXERCISES.map(exercise => exercise.eq).filter(Boolean))]
  .sort((a, b) => {
    const count = eq => AI_EXERCISES.filter(exercise => exercise.eq === eq).length;
    return count(b) - count(a) || a.localeCompare(b);
  });

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
  if (!text(profile.gymName)) missing.push('academia');
  if (!Array.isArray(profile.equipment) || !profile.equipment.length) missing.push('aparelhos');
  return missing;
}

export function candidateExercises(profile = {}, catalogue = AI_EXERCISES) {
  const allowed = new Set((profile.equipment || []).map(item => String(item).toLowerCase()).filter(Boolean));
  const blocked = new Set((profile.blockedExerciseIds || []).map(String));
  const favorites = new Set((profile.favoriteExerciseIds || []).map(String));
  const targets = new Set((profile.targetAreas || []).map(String));
  const bodyWeightAllowed = allowed.size === 0 || allowed.has('body weight') || allowed.has('peso corporal');
  const rows = catalogue.filter(exercise =>
    !blocked.has(exercise.id) &&
    (allowed.size === 0 || allowed.has(String(exercise.eq).toLowerCase()) || (exercise.eq === 'body weight' && bodyWeightAllowed))
  );
  const ranked = rows.length ? rows : catalogue.filter(exercise => exercise.eq === 'body weight');
  return ranked
    .map((exercise, index) => ({
      exercise,
      score: (favorites.has(exercise.id) ? 50 : 0) + (targets.has(exercise.bp) ? 12 : 0) + (exercise.eq === 'body weight' ? 2 : 0) - index / 10000
    }))
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
    .slice(0, 120)
    .map(item => item.exercise);
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
      academia: text(profile.gymName, 120),
      medidasCm: {
        cintura: profile.measurements?.waist || null,
        peito: profile.measurements?.chest || null,
        quadril: profile.measurements?.hip || null,
        braco: profile.measurements?.arm || null,
        coxa: profile.measurements?.thigh || null,
        panturrilha: profile.measurements?.calf || null
      },
      focoCorporal: (profile.targetAreas || []).slice(0, 5),
      restricoes: text(profile.limitations, 260),
      preferencias: text(profile.preferences, 260),
      aparelhosFavoritos: (profile.favoriteEquipment || []).slice(0, 8),
      exerciciosFavoritos: (profile.favoriteExerciseIds || []).slice(0, 12),
      exerciciosBloqueados: (profile.blockedExerciseIds || []).slice(0, 24)
    },
    aparelhosDisponiveis: [...new Set(candidates.map(item => item.eq))],
    exerciciosPermitidos: candidates.map(item => ({ id: item.id, nome: item.name, grupo: item.bp, alvo: item.tg, aparelho: item.eq }))
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

export function normalizeAiWorkout(plan, candidates, options = {}) {
  const allowed = new Set(candidates.map(item => item.id));
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.routines)) throw new Error('invalid workout');
  const idMap = new Map();
  const usedIds = new Set(options.existingIds || []);
  const idFactory = options.idFactory || (() => `ai-${crypto.randomUUID()}`);
  const nextId = () => {
    let id;
    do { id = text(idFactory(), 80); } while (!id || usedIds.has(id));
    usedIds.add(id);
    return id;
  };
  const routines = plan.routines.slice(0, 7).map((routine, index) => {
    const sourceId = text(routine.id, 60) || `ia-${index + 1}`;
    const safeId = nextId();
    if (!idMap.has(sourceId)) idMap.set(sourceId, safeId);
    return {
    id: safeId,
    name: text(routine.name, 80) || `Treino IA ${index + 1}`,
    emoji: routine.emoji || 'sparkles',
    _aiGenerated: true,
    _aiSourceRoutineId: sourceId,
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
  };
  }).filter(routine => routine.ex.length);
  if (!routines.length) throw new Error('empty workout');
  const routineIds = new Set(routines.map(item => item.id));
  const weekEntries = Array.isArray(plan.week)
    ? plan.week.map(item => [String(item.day), item.routineId])
    : Object.entries(plan.week || {});
  const week = Object.fromEntries(weekEntries
    .map(([day, routineId]) => [day, idMap.get(routineId) || routineId])
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
  const week = Object.fromEntries(Object.entries(state.week || {}).filter(([, routineId]) => !oldAi.has(routineId)));
  for (const [day, routineId] of Object.entries(normalized.week || {})) {
    const current = state.week?.[day];
    if (!current || oldAi.has(current)) week[day] = routineId;
  }
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
