import crypto from 'node:crypto';

import {
  AI_EXERCISES,
  AI_WORKOUT_SCHEMA,
  assertGenerationEligible,
  buildWorkoutPrompt,
  computeContextHash,
  shortlistExercises,
  validateAiWorkoutPlan
} from './ai.js';
import { generationContext } from './ai-jobs.js';
import { failedGenerationUsage } from './ai-providers.js';

const FOCUS = Object.freeze({
  legs: {
    label: 'pernas', emoji: 'legs', focusAreas: ['upper legs', 'lower legs', 'quads', 'hamstrings', 'glutes', 'calves'],
    accepts: exercise => ['upper legs', 'lower legs'].includes(exercise.bp) || ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'].includes(exercise.tg)
  },
  push: {
    label: 'empurrar', emoji: 'barbell', focusAreas: ['chest', 'shoulders', 'pectorals', 'delts', 'triceps'],
    accepts: exercise => ['chest', 'shoulders'].includes(exercise.bp) || ['pectorals', 'delts', 'triceps'].includes(exercise.tg)
  },
  pull: {
    label: 'puxar', emoji: 'pullup', focusAreas: ['back', 'upper arms', 'lower arms', 'lats', 'upper back', 'traps', 'biceps', 'forearms'],
    accepts: exercise => ['back', 'upper arms', 'lower arms'].includes(exercise.bp) || ['lats', 'upper back', 'traps', 'biceps', 'forearms'].includes(exercise.tg)
  },
  full_body: {
    label: 'corpo inteiro', emoji: 'dumbbell', focusAreas: ['chest', 'back', 'upper legs', 'shoulders', 'waist'],
    accepts: () => true
  },
  core: {
    label: 'core', emoji: 'target', focusAreas: ['waist', 'abs', 'spine'],
    accepts: exercise => exercise.bp === 'waist' || ['abs', 'spine'].includes(exercise.tg)
  },
  cardio: {
    label: 'cardio', emoji: 'heart', focusAreas: ['cardio', 'cardiovascular system'],
    accepts: exercise => exercise.bp === 'cardio' || exercise.tg === 'cardiovascular system'
  }
});

const fail = (message, status = 400) => Object.assign(new Error(message), { expose: true, status });

function frontendExercise(exercise) {
  return {
    id: exercise.exerciseId,
    _aiExerciseId: exercise.id,
    mode: exercise.mode,
    sets: exercise.sets,
    ...(exercise.mode === 'reps' ? {
      reps: exercise.repMin,
      repsMin: exercise.repMin,
      repsMax: exercise.repMax
    } : {}),
    ...(exercise.mode === 'time' ? { sec: exercise.seconds } : {}),
    ...(exercise.mode === 'cardio' ? { min: Math.max(1, Math.round(exercise.seconds / 60)) } : {}),
    rest: exercise.restSeconds,
    weight: 0,
    note: exercise.note,
    progression: exercise.progression
  };
}

function editableRoutine(plan, focus, generatedAt, routineId) {
  const routine = plan.routines[0];
  return {
    id: routineId,
    name: routine.name,
    emoji: FOCUS[focus].emoji,
    ex: routine.exercises.map(frontendExercise),
    _aiSuggested: true,
    sourceType: 'ai',
    readOnly: false,
    _aiProvider: plan.provider,
    _aiModel: plan.model,
    _aiJustification: plan.justification,
    _aiGeneratedAt: generatedAt
  };
}

export function createAiRoutineService({
  store,
  readState,
  getActiveProvider,
  runStructured,
  appendUsage,
  catalogue = AI_EXERCISES,
  now = () => new Date().toISOString(),
  randomId = () => crypto.randomUUID()
}) {
  if (!store || typeof store.read !== 'function') throw new TypeError('collaboration store required');
  if (typeof runStructured !== 'function') throw new TypeError('structured provider runner required');
  const inFlight = new Map();
  let routineSequence = 0;

  const nextRoutineId = (studentId, focus, existingIds) => {
    let id;
    do {
      routineSequence += 1;
      id = `ai-routine-${crypto.createHash('sha256')
        .update(`${studentId}:${focus}:${randomId()}:${routineSequence}`)
        .digest('hex').slice(0, 18)}`;
    } while (existingIds.has(id));
    return id;
  };

  return Object.freeze({
    async generate({ studentId, focus }) {
      const focusKey = String(focus || '').trim();
      const focusDefinition = FOCUS[focusKey];
      if (!focusDefinition) throw fail('Selecione um foco de treino válido.');

      const startedAt = Date.now();
      const generatedAt = now();
      const collaboration = store.read();
      const localState = typeof readState === 'function' ? readState(studentId) || {} : {};
      const baseContext = generationContext(collaboration, studentId, localState, generatedAt);
      const day = baseContext.profile?.availableDays?.find(value => Number.isInteger(value) && value >= 0 && value <= 6) ?? 1;
      const context = {
        ...baseContext,
        profile: {
          ...baseContext.profile,
          availableDays: [day],
          focusAreas: focusDefinition.focusAreas
        }
      };
      assertGenerationEligible(context);

      const candidates = shortlistExercises({
        profile: context.profile,
        gym: context.gym,
        recentExerciseIds: context.trainingSummary.exerciseIds,
        catalogue
      }).filter(focusDefinition.accepts);
      if (!candidates.length) throw fail('Nenhum exercício compatível com esse foco está disponível.', 422);

      const contextHash = computeContextHash(context);
      const requestKey = JSON.stringify([studentId, focusKey, contextHash]);
      const pending = inFlight.get(requestKey);
      if (pending) return pending;

      const generation = (async () => {
        const provider = getActiveProvider?.();
        if (!provider) throw fail('Nenhum provedor de IA testado está ativo.', 503);
        let generated;
        const existingIds = new Set((localState.routines || []).map(routine => routine?.id).filter(Boolean));
        try {
          const prompt = [
            buildWorkoutPrompt({ context, candidates, requestNonce: randomId() }),
            '',
            '## Pedido de rotina única',
            `- Crie exatamente uma rotina de ${focusDefinition.label}, em pt-BR.`,
            `- Use exatamente um item em routines e um item em schedule no dia ${day}.`
          ].join('\n');
          generated = await runStructured(provider, { prompt, schema: AI_WORKOUT_SCHEMA });
          if (generated?.value?.routines?.length !== 1 || generated?.value?.schedule?.length !== 1) {
            throw new Error('AI single routine response has invalid cardinality');
          }
          const plan = validateAiWorkoutPlan(generated.value, {
            studentId,
            version: 1,
            contextHash,
            profile: context.profile,
            gym: context.gym,
            candidates,
            provider: provider.provider,
            model: provider.selectedModel,
            now: generatedAt,
            existingIds: [...existingIds]
          });
          appendUsage?.(generated.usage, {
            status: 'success', studentId, latencyMs: Date.now() - startedAt, timestamp: generatedAt
          });
          return { routine: editableRoutine(plan, focusKey, generatedAt, nextRoutineId(studentId, focusKey, existingIds)) };
        } catch (error) {
          if (!generated && error?.usage) generated = { usage: error.usage };
          appendUsage?.(failedGenerationUsage(generated, provider), {
            status: 'failed', studentId, latencyMs: Date.now() - startedAt, timestamp: generatedAt
          });
          throw error;
        }
      })();
      inFlight.set(requestKey, generation);
      try {
        return await generation;
      } finally {
        if (inFlight.get(requestKey) === generation) inFlight.delete(requestKey);
      }
    }
  });
}

export function createAiRoutineRoutes({ service, readSession, readBody, json, beforeGenerate }) {
  return {
    'POST /api/ai/routine': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      if (typeof beforeGenerate === 'function' && !beforeGenerate(req, res, user)) return;
      try {
        const body = await readBody(req);
        const result = await service.generate({ studentId: user.id, focus: body?.focus });
        return json(res, 200, result);
      } catch (error) {
        const status = error?.expose && Number.isInteger(error.status) ? error.status : 400;
        return json(res, status, {
          error: error?.expose ? error.message : 'Não foi possível criar a rotina com IA.'
        });
      }
    }
  };
}
