const canonicalUsage = value => ({
  provider: value?.provider,
  model: value?.model,
  inputTokens: value?.inputTokens,
  outputTokens: value?.outputTokens,
  totalTokens: value?.totalTokens,
  latencyMs: value?.latencyMs,
  status: value?.status,
  ...(value?.studentId ? { studentId: value.studentId } : {}),
  timestamp: value?.timestamp
});

const fingerprint = value => JSON.stringify(canonicalUsage(value));

function updateWithRetry(store, reducer) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = store.read();
    try { return store.update(current.rev, reducer); }
    catch (error) {
      if (error?.name !== 'RevisionConflictError' || attempt === 2) throw error;
    }
  }
  throw new Error('unable to update AI usage');
}

function mergeUsage(current, legacy) {
  const byFingerprint = new Map();
  for (const row of [...(current || []), ...(legacy || [])]) byFingerprint.set(fingerprint(row), canonicalUsage(row));
  return [...byFingerprint.values()].slice(-2000);
}

/**
 * Keeps the Task 1 operational `db.aiUsage` reader/writer surface while making
 * collaboration.aiUsage the only persisted canonical collection.
 */
export function bridgeAiUsageProperty({ db, store, saveDb }) {
  const legacy = Array.isArray(db.aiUsage) ? structuredClone(db.aiUsage) : [];
  if (legacy.length) {
    updateWithRetry(store, state => ({
      ...state,
      aiUsage: mergeUsage(state.aiUsage, legacy)
    }));
  }
  delete db.aiUsage;
  Object.defineProperty(db, 'aiUsage', {
    configurable: false,
    enumerable: false,
    get() {
      return store.read().aiUsage;
    },
    set(entries) {
      updateWithRetry(store, state => ({
        ...state,
        aiUsage: mergeUsage([], Array.isArray(entries) ? entries : [])
      }));
    }
  });
  if (typeof saveDb === 'function') saveDb();
  return {
    read: () => db.aiUsage,
    replace: entries => { db.aiUsage = entries; return db.aiUsage; }
  };
}
