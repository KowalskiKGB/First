import crypto from 'node:crypto';
import {
  AI_WORKOUT_SCHEMA,
  assertGenerationEligible,
  buildWorkoutPrompt,
  computeContextHash,
  shortlistExercises,
  validateAiWorkoutPlan
} from './ai.js';
import { failedGenerationUsage } from './ai-providers.js';

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);
const SAFE_FAILURE_CODES = new Set(['provider_response_truncated']);
const PUBLIC_GENERATION_ERROR = 'Não foi possível gerar o plano. Tente novamente mais tarde.';
const PUBLIC_INTERRUPTION_ERROR = 'A geração foi interrompida por uma reinicialização. Crie um novo pedido.';

const text = (value, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeFailureCode = value => SAFE_FAILURE_CODES.has(value) ? value : null;
class ExistingJobSelection extends Error {
  constructor(job) {
    super('existing AI job selected');
    this.job = job;
  }
}
const publicJob = job => job ? {
  id: job.id,
  status: job.status,
  stage: job.stage,
  failureCode: safeFailureCode(job.failureCode),
  publicError: job.publicError || null,
  contextHash: job.contextHash || '',
  planVersion: job.planVersion || null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt
} : null;

function updateStore(store, reducer) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = store.read();
    try { return store.update(current.rev, reducer); }
    catch (error) {
      if (error?.name !== 'RevisionConflictError' || attempt === 2) throw error;
    }
  }
}

function latestMeasurements(collaboration, studentId) {
  const keyByKind = {
    weight: 'weightKg', waist: 'waistCm', chest: 'chestCm', hip: 'hipCm',
    arm: 'armCm', thigh: 'thighCm', calf: 'calfCm'
  };
  const rows = (collaboration.measurements || [])
    .filter(item => item.studentUserId === studentId)
    .slice()
    .sort((a, b) => String(b.observedAt || b.createdAt || '').localeCompare(String(a.observedAt || a.createdAt || '')));
  const current = {};
  for (const row of rows) {
    const key = keyByKind[row.kind];
    if (key && !(key in current) && Number.isFinite(Number(row.value))) current[key] = Number(row.value);
  }
  return { current };
}

function workoutExerciseIds(workout) {
  const rows = workout?.entries || workout?.ex || workout?.exercises || [];
  return (Array.isArray(rows) ? rows : []).map(item => text(item?.id || item?.exerciseId, 100)).filter(Boolean);
}

export function summarizeRecentTraining(state = {}, now = new Date().toISOString()) {
  const cutoff = new Date(now).getTime() - 28 * 86_400_000;
  const workouts = (Array.isArray(state.workouts) ? state.workouts : []).filter(workout => {
    const timestamp = new Date(`${String(workout?.d || '').slice(0, 10)}T12:00:00.000Z`).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  return {
    windowDays: 28,
    frequency: workouts.length,
    volume: workouts.reduce((sum, workout) => sum + Math.max(0, Number(workout.vol) || 0), 0),
    exerciseIds: [...new Set(workouts.flatMap(workoutExerciseIds))].sort()
  };
}

export function generationContext(collaboration, studentId, state, now) {
  const profile = collaboration.trainingProfiles.find(item => item.studentId === studentId) || null;
  const gym = collaboration.gymProfiles.find(item => item.studentId === studentId) || null;
  return {
    studentId,
    profile,
    gym,
    measurements: latestMeasurements(collaboration, studentId),
    preferences: { notes: text(state?.aiPreferences?.notes || state?.aiProfile?.preferences, 300) },
    trainingSummary: summarizeRecentTraining(state, now)
  };
}

function nextVersion(collaboration, studentId) {
  return Math.max(0, ...(collaboration.aiPlans || [])
    .filter(plan => plan.studentId === studentId)
    .map(plan => Number(plan.version) || 0)) + 1;
}

function jobPatch(store, jobId, patch) {
  return updateStore(store, state => ({
    ...state,
    aiJobs: state.aiJobs.map(job => job.id === jobId ? { ...job, ...patch } : job)
  }));
}

export function createAiJobService({
  store,
  readState,
  getActiveProvider,
  runStructured,
  appendUsage,
  notifyApplied,
  now = () => new Date().toISOString(),
  randomId = () => crypto.randomBytes(16).toString('base64url'),
  defer = callback => queueMicrotask(callback)
}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') throw new TypeError('collaboration store required');
  const runner = runStructured;
  let draining = null;

  const processJob = async jobId => {
    let generated;
    let provider;
    let providerCalled = false;
    let stage = 'organizing';
    const startedAt = Date.now();
    const started = now();
    jobPatch(store, jobId, { status: 'running', stage, updatedAt: started, failureCode: null, publicError: null });
    const initial = store.read();
    const job = initial.aiJobs.find(item => item.id === jobId);
    if (!job || job.status !== 'running') return;
    try {
      const state = typeof readState === 'function' ? readState(job.studentId) || {} : {};
      const context = generationContext(initial, job.studentId, state, started);
      assertGenerationEligible(context);
      const candidates = shortlistExercises({
        profile: context.profile,
        gym: context.gym,
        recentExerciseIds: context.trainingSummary.exerciseIds
      });
      if (!candidates.length) throw Object.assign(new Error('Nenhum exercício compatível está disponível.'), { expose: true });
      const contextHash = computeContextHash(context);
      stage = 'generating';
      jobPatch(store, jobId, { stage, contextHash, updatedAt: now() });
      provider = getActiveProvider?.();
      if (!provider) throw Object.assign(new Error('Nenhum provedor de IA ativo está disponível.'), { expose: true });
      const prompt = buildWorkoutPrompt({ context, candidates, requestNonce: randomId() });
      providerCalled = true;
      generated = await runner(provider, { prompt, schema: AI_WORKOUT_SCHEMA });
      stage = 'validating';
      jobPatch(store, jobId, { stage, updatedAt: now() });
      const appliedAt = now();
      stage = 'applying';
      jobPatch(store, jobId, { stage, updatedAt: appliedAt });
      const applied = updateStore(store, collaboration => {
        const currentState = typeof readState === 'function' ? readState(job.studentId) || {} : {};
        const currentContext = generationContext(collaboration, job.studentId, currentState, started);
        assertGenerationEligible(currentContext);
        const currentCandidates = shortlistExercises({
          profile: currentContext.profile,
          gym: currentContext.gym,
          recentExerciseIds: currentContext.trainingSummary.exerciseIds
        });
        const currentHash = computeContextHash(currentContext);
        if (currentHash !== contextHash || currentCandidates.length !== candidates.length ||
            currentCandidates.some((candidate, index) => candidate.id !== candidates[index]?.id)) {
          throw new Error('AI generation context changed before application');
        }
        const version = nextVersion(collaboration, job.studentId);
        const plan = validateAiWorkoutPlan(generated.value, {
          studentId: job.studentId,
          version,
          contextHash: currentHash,
          profile: currentContext.profile,
          gym: currentContext.gym,
          candidates: currentCandidates,
          provider: provider.provider,
          model: provider.selectedModel,
          now: appliedAt,
          existingIds: [
            ...(collaboration.aiPlans || []).flatMap(item => [item.id, ...(item.routines || []).map(routine => routine.id)]),
            ...(currentState.routines || []).map(routine => routine?.id).filter(Boolean)
          ]
        });
        const plans = collaboration.aiPlans.map(item => item.studentId === job.studentId && item.source === 'ai' && item.status === 'applied'
          ? { ...item, status: 'superseded', updatedAt: appliedAt }
          : item);
        const next = {
          ...collaboration,
          aiPlans: [...plans, plan],
          aiJobs: collaboration.aiJobs.map(item => item.id === jobId ? {
            ...item,
            status: 'applied',
            stage: 'applying',
            failureCode: null,
            publicError: null,
            contextHash: currentHash,
            planVersion: version,
            updatedAt: appliedAt
          } : item)
        };
        return typeof notifyApplied === 'function'
          ? notifyApplied(next, { studentId: job.studentId, planId: plan.id, now: appliedAt })
          : next;
      });
      if (providerCalled && typeof appendUsage === 'function') appendUsage(generated.usage, {
        status: 'success', studentId: job.studentId, latencyMs: Date.now() - startedAt, timestamp: appliedAt
      });
      return publicJob(applied.aiJobs.find(item => item.id === jobId));
    } catch (error) {
      const failedAt = now();
      if (providerCalled && typeof appendUsage === 'function') {
        if (!generated && error?.usage) generated = { usage: error.usage };
        appendUsage(failedGenerationUsage(generated, provider), {
          status: 'failed', studentId: job?.studentId, latencyMs: Date.now() - startedAt, timestamp: failedAt
        });
      }
      const failureCode = safeFailureCode(error?.failureCode);
      const publicError = !providerCalled && error?.expose ? text(error.message, 240) : PUBLIC_GENERATION_ERROR;
      const failed = jobPatch(store, jobId, { status: 'failed', stage, failureCode, publicError, updatedAt: failedAt });
      return publicJob(failed.aiJobs.find(item => item.id === jobId));
    }
  };

  const service = {
    enqueue({ studentId, idempotencyKey }) {
      const owner = text(studentId, 100);
      const key = text(idempotencyKey, 160);
      if (!owner || !key) throw Object.assign(new Error('idempotency key obrigatória'), { expose: true, status: 400 });
      const requestedAt = new Date(now()).getTime();
      let job;
      try {
        updateStore(store, state => {
          const same = state.aiJobs.find(item => item.studentId === owner && item.idempotencyKey === key);
          if (same) throw new ExistingJobSelection(same);
          const active = state.aiJobs.find(item => item.studentId === owner && ACTIVE_JOB_STATUSES.has(item.status));
          if (active) throw new ExistingJobSelection(active);
          const recentJobs = state.aiJobs.filter(item => item.studentId === owner &&
            requestedAt - new Date(item.createdAt).getTime() < 3_600_000);
          if (recentJobs.length >= 6) {
            throw Object.assign(new Error('Limite de gerações atingido. Tente novamente mais tarde.'), { expose: true, status: 429 });
          }
          const createdAt = now();
          job = {
            id: randomId(), idempotencyKey: key, studentId: owner,
            status: 'queued', stage: 'organizing', failureCode: null, publicError: null,
            contextHash: '', planVersion: null, createdAt, updatedAt: createdAt
          };
          return { ...state, aiJobs: [...state.aiJobs, job] };
        });
      } catch (error) {
        if (error instanceof ExistingJobSelection) return publicJob(error.job);
        throw error;
      }
      defer(() => { service.drain().catch(() => {}); });
      return publicJob(job);
    },
    async drain() {
      if (draining) return draining;
      draining = (async () => {
        while (true) {
          const queued = store.read().aiJobs.find(job => job.status === 'queued');
          if (!queued) break;
          await processJob(queued.id);
        }
      })();
      try { await draining; }
      finally { draining = null; }
    },
    getJob({ studentId, jobId }) {
      const job = store.read().aiJobs.find(item => item.id === jobId && item.studentId === studentId);
      return publicJob(job);
    },
    recoverInterrupted() {
      const recoveredAt = now();
      let count = 0;
      updateStore(store, state => ({
        ...state,
        aiJobs: state.aiJobs.map(job => {
          if (job.status !== 'running') return job;
          count += 1;
          return { ...job, status: 'failed', failureCode: null, publicError: PUBLIC_INTERRUPTION_ERROR, updatedAt: recoveredAt };
        })
      }));
      return count;
    },
    rollback({ studentId, planId }) {
      const rolledAt = now();
      let target;
      updateStore(store, state => {
        target = state.aiPlans.find(plan => plan.id === planId && plan.studentId === studentId && plan.source === 'ai');
        if (!target) throw Object.assign(new Error('plano não encontrado'), { expose: true, status: 404 });
        return {
          ...state,
          aiPlans: state.aiPlans.map(plan => {
            if (plan.studentId !== studentId) return plan;
            if (plan.id === target.id) return { ...plan, status: 'applied', appliedAt: rolledAt, updatedAt: rolledAt };
            return plan.source === 'ai' && plan.status === 'applied'
              ? { ...plan, status: 'superseded', updatedAt: rolledAt }
              : plan;
          })
        };
      });
      return store.read().aiPlans.find(plan => plan.id === target.id);
    }
  };
  return service;
}

export function createAiJobRoutes({ service, readSession, readBody, json, requireTrustedWrite }) {
  const withUser = async (req, res, handler) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try { return await handler(user); }
    catch (error) {
      const status = error?.expose && Number.isInteger(error.status) ? error.status : 400;
      return json(res, status, { error: error?.expose ? error.message : 'invalid request' });
    }
  };
  return {
    'POST /api/ai/jobs': (req, res) => withUser(req, res, async user => {
      if (typeof requireTrustedWrite === 'function' && !requireTrustedWrite(req, res)) return;
      const body = await readBody(req);
      const idempotencyKey = text(req.headers?.['idempotency-key'] || body.idempotencyKey, 160);
      const job = service.enqueue({ studentId: user.id, idempotencyKey });
      json(res, 202, { job });
    }),
    'GET /api/ai/job': (req, res) => withUser(req, res, async user => {
      const jobId = new URL(req.url, 'http://x').searchParams.get('id');
      const job = service.getJob({ studentId: user.id, jobId });
      if (!job) return json(res, 404, { error: 'job not found' });
      json(res, 200, { job });
    }),
    'POST /api/ai/plan/rollback': (req, res) => withUser(req, res, async user => {
      if (typeof requireTrustedWrite === 'function' && !requireTrustedWrite(req, res)) return;
      const body = await readBody(req);
      const plan = service.rollback({ studentId: user.id, planId: text(body.planId, 100) });
      json(res, 200, { plan });
    })
  };
}
