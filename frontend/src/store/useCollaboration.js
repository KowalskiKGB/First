import { create } from 'zustand';

import { api } from '../lib/api.js';
import { DEMO } from '../lib/demo.js';
import { t } from '../lib/i18n.js';
import { MOBILE } from '../lib/mobile.js';

const initial = {
  ownerId: null,
  rev: 0,
  profile: null,
  connections: [],
  notifications: [],
  workspace: null,
  selected: null,
  detail: null,
  loading: false,
  error: null,
  message: null,
};

const clean = () => ({ ...initial, connections: [], notifications: [] });

const revoked = ownerId => {
  localStorage.removeItem('first_context');
  return { ...clean(), ownerId, context: 'student', message: t('Permission revoked') };
};

function storedUser() {
  try { return JSON.parse(localStorage.getItem('gym_user') || 'null'); }
  catch { return null; }
}

const realWebAccount = user =>
  !!user?.id && storedUser()?.id === user.id && !DEMO && !MOBILE && localStorage.getItem('gym_guest') !== '1';

function initialContext() {
  const context = localStorage.getItem('first_context');
  return realWebAccount(storedUser()) && context === 'trainer' ? 'trainer' : 'student';
}

export const useCollaboration = create((set, get) => ({
  ...clean(),
  context: initialContext(),

  setContext(context, user) {
    const next = realWebAccount(user) && context === 'trainer' ? 'trainer' : 'student';
    if (next === 'trainer') localStorage.setItem('first_context', next);
    else localStorage.removeItem('first_context');
    set({ context: next });
  },

  reset() {
    localStorage.removeItem('first_context');
    set({ ...clean(), context: 'student' });
  },

  async load(user) {
    if (!realWebAccount(user)) { get().reset(); return; }
    const switchingAccount = get().ownerId !== user.id;
    set(switchingAccount
      ? { ...clean(), ownerId: user.id, context: initialContext(), loading: true }
      : { loading: true, error: null, message: null });
    try {
      const base = await api('/api/collaboration');
      if (get().ownerId !== user.id) return;
      const profile = base.profile?.userId === user.id ? base.profile : null;
      const workspace = profile?.roles?.includes('trainer')
        ? await api('/api/personal/workspace')
        : null;
      if (get().ownerId !== user.id) return;
      set({
        ownerId: user.id,
        rev: workspace?.rev ?? base.rev ?? 0,
        profile,
        connections: Array.isArray(base.connections) ? base.connections : [],
        notifications: Array.isArray(base.notifications) ? base.notifications : [],
        workspace,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (get().ownerId !== user.id) return;
      if (error.status === 401 || error.status === 403) {
        set({ ...revoked(user.id), message: error.status === 403 ? t('Permission revoked') : null, error: error.message });
        return;
      }
      set({ loading: false, error: error.message || t('Could not load Personal') });
    }
  },

  async reloadWorkspace() {
    if (!get().profile?.roles?.includes('trainer')) return null;
    const ownerId = get().ownerId;
    try {
      const workspace = await api('/api/personal/workspace');
      if (get().ownerId === ownerId) set({ workspace, rev: workspace.rev ?? get().rev });
      return workspace;
    } catch (error) {
      if (error.status === 403 && get().ownerId === ownerId) set(revoked(ownerId));
      throw error;
    }
  },

  async loadClient(id) {
    const ownerId = get().ownerId;
    set({ selected: id, loading: true, error: null, message: null });
    try {
      const detail = await api('/api/personal/client?id=' + encodeURIComponent(id));
      if (get().ownerId === ownerId && get().selected === id) {
        set({ detail, rev: detail.rev ?? get().rev, loading: false });
      }
      return detail;
    } catch (error) {
      if (get().ownerId === ownerId) {
        set(error.status === 403
          ? { workspace: null, detail: null, selected: null, loading: false, message: t('Permission revoked') }
          : { loading: false, error: error.message || t('Could not load student') });
      }
      throw error;
    }
  },

  selectClient(id) {
    if (!id) { set({ selected: null, detail: null }); return Promise.resolve(null); }
    return get().loadClient(id);
  },

  async mutate(path, body, method = 'POST') {
    const ownerId = get().ownerId;
    const payload = { ...body, rev: get().rev };
    try {
      const result = await api(path, { method, body: JSON.stringify(payload) });
      if (get().ownerId !== ownerId) return result;
      if (result.profile) set({ profile: result.profile, rev: result.rev ?? get().rev });
      else if (result.client) set({ detail: result, rev: result.rev ?? get().rev });
      else if (result.clients || result.kpis) set({ workspace: result, rev: result.rev ?? get().rev });
      else if (result.rev != null) set({ rev: result.rev });
      set({ error: null, message: null });
      return result;
    } catch (error) {
      if (get().ownerId !== ownerId) throw error;
      if (error.status === 409) {
        const user = storedUser();
        const selected = get().selected;
        if (user?.id === get().ownerId) await get().load(user);
        if (get().ownerId === ownerId && selected && get().profile?.roles?.includes('trainer')) {
          try { await get().loadClient(selected); } catch { /* loadClient already revoked unsafe detail */ }
        }
        set({ message: t('Data updated; repeat the action') });
      } else if (error.status === 403) {
        set({ workspace: null, detail: null, selected: null, message: t('Permission revoked') });
      }
      throw error;
    }
  },

  activateTrainer() {
    const roles = [...new Set([...(get().profile?.roles || ['student']), 'trainer'])];
    return get().mutate('/api/profile/roles', { roles }, 'PUT');
  },
}));
