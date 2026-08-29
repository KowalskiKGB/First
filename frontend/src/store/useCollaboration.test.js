import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();

function storage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
  };
}

async function collaborationStore({ demo = false, mobile = false } = {}) {
  vi.resetModules();
  vi.doMock('../lib/api.js', () => ({ api: apiMock }));
  vi.doMock('../lib/demo.js', () => ({ DEMO: demo }));
  vi.doMock('../lib/mobile.js', () => ({ MOBILE: mobile }));
  vi.doMock('../lib/i18n.js', () => ({
    t: key => ({
      'Data updated; repeat the action': 'Dados atualizados; repita a ação',
      'Permission revoked': 'Permissão revogada',
    })[key] || key,
  }));
  return (await import('./useCollaboration.js')).useCollaboration;
}

beforeEach(() => {
  globalThis.localStorage = storage();
  apiMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  delete globalThis.localStorage;
});

describe('collaboration context', () => {
  it('removes the persisted context on reset', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    localStorage.setItem('first_context', 'trainer');
    const store = await collaborationStore();

    store.getState().reset();

    expect(store.getState().context).toBe('student');
    expect(localStorage.getItem('first_context')).toBeNull();
  });

  it('persists trainer context only for a real web account', async () => {
    const store = await collaborationStore();
    store.getState().setContext('trainer', { id: 'u1' });
    expect(store.getState().context).toBe('student');
    expect(localStorage.getItem('first_context')).toBeNull();

    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    store.getState().setContext('trainer', { id: 'u1' });
    expect(store.getState().context).toBe('trainer');
    expect(localStorage.getItem('first_context')).toBe('trainer');

    localStorage.setItem('gym_guest', '1');
    store.getState().setContext('trainer', { id: 'u1' });
    expect(store.getState().context).toBe('student');
    expect(localStorage.getItem('first_context')).toBeNull();
  });
});

describe('collaboration loading boundaries', () => {
  it.each([
    ['guest', { guest: true }],
    ['demo', { demo: true }],
    ['mobile', { mobile: true }],
  ])('never calls the API for %s', async (_label, mode) => {
    if (mode.guest) localStorage.setItem('gym_guest', '1');
    const store = await collaborationStore(mode);

    await store.getState().load({ id: 'u1' });

    expect(apiMock).not.toHaveBeenCalled();
  });

  it('clears another user projection before the next request resolves', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u2' }));
    const store = await collaborationStore();
    store.setState({
      ownerId: 'u1',
      profile: { userId: 'u1', roles: ['trainer'] },
      workspace: { clients: [{ id: 'private-u1' }] },
      detail: { client: { id: 'private-u1' } },
    });
    apiMock.mockResolvedValueOnce({ rev: 2, profile: { userId: 'u2', roles: ['student'] } });

    const loading = store.getState().load({ id: 'u2' });

    expect(store.getState()).toMatchObject({ ownerId: 'u2', profile: null, workspace: null, detail: null });
    await loading;
  });

  it('fails closed when workspace access is revoked during load', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    localStorage.setItem('first_context', 'trainer');
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', profile: { userId: 'u1', roles: ['trainer'] }, workspace: { clients: [{ id: 'private' }] }, detail: { client: { id: 'private' } }, context: 'trainer' });
    apiMock
      .mockResolvedValueOnce({ rev: 4, profile: { userId: 'u1', roles: ['trainer'] } })
      .mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));

    await store.getState().load({ id: 'u1' });

    expect(store.getState()).toMatchObject({ profile: null, workspace: null, detail: null, context: 'student', message: 'Permissão revogada' });
    expect(localStorage.getItem('first_context')).toBeNull();
  });

  it('fails closed when a workspace refresh returns 403', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    localStorage.setItem('first_context', 'trainer');
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', profile: { userId: 'u1', roles: ['trainer'] }, workspace: { clients: [{ id: 'private' }] }, detail: { client: { id: 'private' } }, context: 'trainer' });
    apiMock.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(store.getState().reloadWorkspace()).rejects.toMatchObject({ status: 403 });

    expect(store.getState()).toMatchObject({ profile: null, workspace: null, detail: null, context: 'student', message: 'Permissão revogada' });
    expect(localStorage.getItem('first_context')).toBeNull();
  });
});

describe('collaboration mutation recovery', () => {
  it('reloads a safe projection and exposes the retry message after 409', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', rev: 3, profile: { userId: 'u1', roles: ['trainer'] }, workspace: { clients: [] }, selected: 'c1', detail: { client: { id: 'stale' } } });
    apiMock
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
      .mockResolvedValueOnce({ rev: 4, profile: { userId: 'u1', roles: ['trainer'] } })
      .mockResolvedValueOnce({ rev: 4, kpis: {}, clients: [{ id: 'fresh' }] })
      .mockResolvedValueOnce({ rev: 4, client: { id: 'c1', name: 'Fresh detail' } });

    await expect(store.getState().mutate('/api/personal/client', { clientId: 'c1' }, 'PUT')).rejects.toMatchObject({ status: 409 });

    expect(apiMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/personal/client',
      '/api/collaboration',
      '/api/personal/workspace',
      '/api/personal/client?id=c1',
    ]);
    expect(store.getState().workspace.clients).toEqual([{ id: 'fresh' }]);
    expect(store.getState().detail.client.name).toBe('Fresh detail');
    expect(store.getState().message).toBe('Dados atualizados; repita a ação');
  });

  it.each([
    [403, 'Permissão revogada'],
    [401, null],
  ])('preserves fail-closed state when 409 recovery returns %s', async (status, message) => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    localStorage.setItem('first_context', 'trainer');
    const store = await collaborationStore();
    store.setState({
      ownerId: 'u1',
      rev: 3,
      profile: { userId: 'u1', roles: ['trainer'] },
      workspace: { clients: [{ id: 'private' }] },
      selected: 'c1',
      detail: { client: { id: 'private' } },
      context: 'trainer',
    });
    apiMock
      .mockRejectedValueOnce(Object.assign(new Error('stale'), { status: 409 }))
      .mockRejectedValueOnce(Object.assign(new Error('access lost'), { status }));

    await expect(store.getState().mutate('/api/personal/client', { clientId: 'c1' }, 'PUT'))
      .rejects.toMatchObject({ status: 409 });

    expect(store.getState()).toMatchObject({
      profile: null,
      workspace: null,
      detail: null,
      context: 'student',
      error: 'access lost',
      message,
    });
    expect(localStorage.getItem('first_context')).toBeNull();
  });

  it('clears privileged detail immediately after 403', async () => {
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', rev: 3, profile: { userId: 'u1', roles: ['trainer'] }, workspace: { clients: [{ id: 'secret' }] }, detail: { client: { id: 'secret' } } });
    apiMock.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(store.getState().mutate('/api/personal/program', {}, 'PUT')).rejects.toMatchObject({ status: 403 });

    expect(store.getState().detail).toBeNull();
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().message).toBe('Permissão revogada');
  });

  it('clears the privileged workspace when client loading returns 403', async () => {
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', profile: { userId: 'u1', roles: ['trainer'] }, workspace: { clients: [{ id: 'secret' }] }, detail: { client: { id: 'secret' } } });
    apiMock.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(store.getState().loadClient('secret')).rejects.toMatchObject({ status: 403 });

    expect(store.getState()).toMatchObject({ workspace: null, detail: null, selected: null, message: 'Permissão revogada' });
  });

  it('does not let an old account mutation clear the current account detail', async () => {
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u1' }));
    const store = await collaborationStore();
    store.setState({ ownerId: 'u1', rev: 3, profile: { userId: 'u1', roles: ['trainer'] } });
    let rejectMutation;
    apiMock.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectMutation = reject; }));

    const mutation = store.getState().mutate('/api/personal/program', {}, 'PUT');
    localStorage.setItem('gym_user', JSON.stringify({ id: 'u2' }));
    store.setState({ ownerId: 'u2', profile: { userId: 'u2', roles: ['trainer'] }, detail: { client: { id: 'safe-u2' } }, message: null });
    rejectMutation(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(mutation).rejects.toMatchObject({ status: 403 });
    expect(store.getState().detail.client.id).toBe('safe-u2');
    expect(store.getState().message).toBeNull();
  });
});
