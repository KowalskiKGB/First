import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
const resetCollaboration = vi.fn();
const loadCollaboration = vi.fn();
const setCollaborationContext = vi.fn();
const nativeLoad = vi.fn();
const nativeSave = vi.fn();
const syncReminder = vi.fn();

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function appStore({ mobile = false } = {}) {
  vi.resetModules();
  vi.doMock('../lib/api.js', () => ({ api: apiMock }));
  vi.doMock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'seeded' }));
  vi.doMock('../lib/mobile.js', () => ({ MOBILE: mobile, nativeLoad, nativeSave, syncReminder }));
  vi.doMock('./useCollaboration.js', () => ({
    useCollaboration: { getState: () => ({ reset: resetCollaboration, load: loadCollaboration, setContext: setCollaborationContext, context: 'trainer' }) },
  }));
  return (await import('./useStore.js')).useStore;
}

beforeEach(() => {
  globalThis.localStorage = storage({
    gym_user: JSON.stringify({ id: 'u1', name: 'One' }),
    first_context: 'trainer',
  });
  globalThis.document = { addEventListener: vi.fn(), visibilityState: 'visible' };
  apiMock.mockReset();
  resetCollaboration.mockReset();
  loadCollaboration.mockReset();
  setCollaborationContext.mockReset();
  nativeLoad.mockReset();
  nativeSave.mockReset();
  syncReminder.mockReset();
  resetCollaboration.mockImplementation(() => localStorage.removeItem('first_context'));
});

afterEach(() => {
  vi.clearAllMocks();
  delete globalThis.localStorage;
  delete globalThis.document;
});

describe('account collaboration cleanup', () => {
  it('merges a published program into the student plan through the store action', async () => {
    const store = await appStore();
    const syncPrograms = store.getState().syncPersonalPrograms;

    expect(syncPrograms).toBeTypeOf('function');
    syncPrograms?.([{
      id: 'p1', version: 1, name: 'Programa do Personal',
      routines: [{ id: 'a', name: 'Treino A', ex: [{ id: '0043', sets: 3, reps: 10, rest: 60, note: '' }] }],
      week: { 2: 'a' },
    }]);

    expect(store.getState().S.routines).toEqual([
      expect.objectContaining({ id: 'personal-p1-a', name: 'Treino A', _personalProgramId: 'p1' }),
    ]);
    expect(store.getState().S.week[2]).toBe('personal-p1-a');
  });

  it('keeps offline mobile training available while attempting an authenticated session when online', async () => {
    localStorage.removeItem('gym_user');
    const saved = { routines: [{ id: 'local', name: 'Offline', ex: [] }], week: {}, workouts: [], bodyweight: [], _ts: 10 };
    nativeLoad.mockResolvedValue(saved);
    apiMock.mockRejectedValueOnce(new TypeError('offline'));
    const store = await appStore({ mobile: true });

    await store.getState().boot();

    expect(store.getState()).toMatchObject({ ready: true, user: null });
    expect(store.getState().isGuest()).toBe(true);
    expect(store.getState().S.routines[0].name).toBe('Offline');
  });

  it('restores the server account instead of forcing guest mode in an online mobile shell', async () => {
    localStorage.removeItem('gym_user');
    nativeLoad.mockResolvedValue(null);
    apiMock
      .mockResolvedValueOnce({ user: { id: 'u1', name: 'Personal' } })
      .mockResolvedValueOnce({ state: null });
    const store = await appStore({ mobile: true });

    await store.getState().boot();

    expect(store.getState()).toMatchObject({ ready: true, user: { id: 'u1', name: 'Personal' } });
    expect(store.getState().isGuest()).toBe(false);
  });

  it.each(['signOut', 'signOutAll'])('clears collaboration and context synchronously on %s', async action => {
    const store = await appStore();
    let finishLogout;
    apiMock.mockImplementation(path => {
      if (path === '/api/data') return Promise.resolve({});
      return new Promise(resolve => { finishLogout = resolve; });
    });

    const signingOut = store.getState()[action]();

    expect(resetCollaboration).toHaveBeenCalledOnce();
    expect(localStorage.getItem('first_context')).toBeNull();
    await vi.waitFor(() => expect(finishLogout).toBeTypeOf('function'));
    finishLogout({});
    await signingOut;
  });

  it('clears collaboration and context when switching accounts', async () => {
    const store = await appStore();

    store.getState().setUser({ id: 'u2', name: 'Two' });

    expect(resetCollaboration).toHaveBeenCalledOnce();
    expect(localStorage.getItem('first_context')).toBeNull();
  });

  it('keeps the current account context during boot identity refresh', async () => {
    const store = await appStore();

    store.getState().setUser({ id: 'u1', name: 'One refreshed' });

    expect(resetCollaboration).not.toHaveBeenCalled();
    expect(localStorage.getItem('first_context')).toBe('trainer');
  });

  it('reloads the current account projection when sign out everywhere fails', async () => {
    const store = await appStore();
    apiMock.mockImplementation(path => path === '/api/data'
      ? Promise.resolve({})
      : Promise.reject(new Error('offline')));

    await expect(store.getState().signOutAll()).rejects.toThrow('offline');

    expect(resetCollaboration).toHaveBeenCalledOnce();
    expect(loadCollaboration).toHaveBeenCalledWith({ id: 'u1', name: 'One' });
    expect(setCollaborationContext).toHaveBeenCalledWith('trainer', { id: 'u1', name: 'One' });
  });
});
