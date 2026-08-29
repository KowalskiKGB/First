import { create } from 'zustand';

import { api } from '../lib/api.js';
import { DEMO } from '../lib/demo.js';
import { MOBILE } from '../lib/mobile.js';

const empty = {
  rev: 0,
  profile: null,
  connections: [],
  notifications: [],
  workspace: null,
  detail: null,
  loading: false,
  error: null
};

export const useCollaboration = create((set, get) => ({
  ...empty,
  context: localStorage.getItem('first_context') || 'student',

  setContext(context) {
    localStorage.setItem('first_context', context);
    set({ context });
  },

  reset() {
    set({ ...empty, context: 'student' });
  },

  async load(user) {
    if (!user || DEMO || MOBILE) { get().reset(); return; }
    set({ loading: true, error: null });
    try {
      const base = await api('/api/collaboration');
      let workspace = null;
      if (base.profile?.roles?.includes('trainer')) workspace = await api('/api/personal/workspace');
      set({ ...base, workspace, loading: false, error: null });
    } catch (error) {
      set({ loading: false, error: error.message || 'Falha ao carregar Personal' });
    }
  },

  async reloadWorkspace() {
    if (!get().profile?.roles?.includes('trainer')) return;
    const workspace = await api('/api/personal/workspace');
    set({ workspace, rev: workspace.rev });
  },

  async loadClient(id) {
    set({ loading: true, error: null });
    try {
      const detail = await api('/api/personal/client?id=' + encodeURIComponent(id));
      set({ detail, rev: detail.rev, loading: false });
      return detail;
    } catch (error) {
      set({ loading: false, error: error.message || 'Falha ao carregar aluno' });
      throw error;
    }
  },

  async mutate(path, body, method = 'POST') {
    const payload = { rev: get().rev, ...body };
    try {
      const result = await api(path, { method, body: JSON.stringify(payload) });
      if (result.profile) set({ profile: result.profile, rev: result.rev });
      else if (result.client) set({ detail: result, rev: result.rev });
      else if (result.clients || result.kpis) set({ workspace: result, rev: result.rev });
      else if (result.rev != null) set({ rev: result.rev });
      return result;
    } catch (error) {
      if (error.status === 409) await get().load(JSON.parse(localStorage.getItem('gym_user') || 'null'));
      throw error;
    }
  },

  activateTrainer() {
    const roles = [...new Set([...(get().profile?.roles || ['student']), 'trainer'])];
    return get().mutate('/api/profile/roles', { roles }, 'PUT');
  }
}));
