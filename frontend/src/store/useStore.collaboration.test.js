import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
const resetCollaboration = vi.fn();
const loadCollaboration = vi.fn();
const setCollaborationContext = vi.fn();

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

async function appStore() {
  vi.resetModules();
  vi.doMock('../lib/api.js', () => ({ api: apiMock }));
  vi.doMock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'seeded' }));
  vi.doMock('../lib/mobile.js', () => ({ MOBILE: false, nativeLoad: vi.fn(), nativeSave: vi.fn(), syncReminder: vi.fn() }));
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
  resetCollaboration.mockImplementation(() => localStorage.removeItem('first_context'));
});

afterEach(() => {
  vi.clearAllMocks();
  delete globalThis.localStorage;
  delete globalThis.document;
});

describe('account collaboration cleanup', () => {
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
