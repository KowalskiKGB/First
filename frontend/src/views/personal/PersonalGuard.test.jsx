import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({
  user: { id: 'u1' },
  guest: false,
  profile: { userId: 'u1', roles: ['trainer'] },
  ownerId: 'u1',
}));

vi.mock('../../store/useStore.js', () => ({
  useStore: selector => selector({ user: access.user, isGuest: () => access.guest }),
}));
vi.mock('../../store/useCollaboration.js', () => ({
  useCollaboration: selector => selector({
    profile: access.profile,
    ownerId: access.ownerId,
    setContext: vi.fn(),
  }),
}));
vi.mock('../../lib/mobile.js', () => ({ MOBILE: false }));

let PersonalGuard;

beforeAll(async () => {
  PersonalGuard = (await import('./PersonalGuard.jsx')).default;
});

beforeEach(() => {
  Object.assign(access, {
    user: { id: 'u1' },
    guest: false,
    profile: { userId: 'u1', roles: ['trainer'] },
    ownerId: 'u1',
  });
});

const renderGuard = () => renderToStaticMarkup(
  <MemoryRouter><PersonalGuard><span>privileged</span></PersonalGuard></MemoryRouter>,
);

describe('PersonalGuard', () => {
  it('renders for the current real trainer', () => {
    expect(renderGuard()).toContain('privileged');
  });

  it.each([
    ['guest', () => { access.guest = true; }],
    ['missing role', () => { access.profile = { userId: 'u1', roles: ['student'] }; }],
    ['another user projection', () => { access.ownerId = 'u2'; }],
  ])('does not render privileged content for %s', (_label, arrange) => {
    arrange();
    expect(renderGuard()).not.toContain('privileged');
  });
});
