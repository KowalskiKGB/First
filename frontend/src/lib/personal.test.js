import { describe, expect, it } from 'vitest';

import pt from '../locales/pt.js';
import * as personal from './personal.js';

const { formatMoneyBRL, normalizePriority, personalTabs, priorityCopy } = personal;

describe('personal helpers', () => {
  it('formats cents as Brazilian Real without floating point drift', () => {
    expect(formatMoneyBRL(123456)).toBe('R$ 1.234,56');
    expect(formatMoneyBRL(-500)).toBe('-R$ 5,00');
  });

  it('returns trainer navigation without workout start action', () => {
    expect(personalTabs().map(tab => tab.to)).toEqual(['/personal', '/personal/alunos', '/personal/agenda', '/personal/financeiro', '/settings']);
    expect(personalTabs().map(tab => tab.label)).toEqual(['Overview', 'Students', 'Schedule', 'Finances', 'Settings']);
    expect(personalTabs().map(tab => pt[tab.label])).toEqual(['Visão geral', 'Alunos', 'Agenda', 'Financeiro', 'Ajustes']);
  });

  it('keeps priority text explicit and never color-only', () => {
    expect(normalizePriority({ priority: 'urgent' })).toBe('urgent');
    expect(priorityCopy({ priority: 'attention', reasons: ['Medidas antigas'] })).toContain('Medidas antigas');
    expect(priorityCopy({ priority: 'ok', reasons: [] })).toBe('Em dia');
  });

  it.each([
    ['guest', { user: { id: 'u1' }, isGuest: true, mobile: false, profile: { userId: 'u1', roles: ['trainer'] }, ownerId: 'u1' }],
    ['mobile', { user: { id: 'u1' }, isGuest: false, mobile: true, profile: { userId: 'u1', roles: ['trainer'] }, ownerId: 'u1' }],
    ['missing trainer role', { user: { id: 'u1' }, isGuest: false, mobile: false, profile: { userId: 'u1', roles: ['student'] }, ownerId: 'u1' }],
    ['another user projection', { user: { id: 'u2' }, isGuest: false, mobile: false, profile: { userId: 'u1', roles: ['trainer'] }, ownerId: 'u1' }],
  ])('denies the Personal guard for %s', (_case, state) => {
    expect(personal.canEnterPersonal(state)).toBe(false);
  });

  it('allows the Personal guard only for the current real trainer', () => {
    expect(personal.canEnterPersonal({
      user: { id: 'u1' },
      isGuest: false,
      mobile: false,
      profile: { userId: 'u1', roles: ['student', 'trainer'] },
      ownerId: 'u1',
    })).toBe(true);
  });
});
