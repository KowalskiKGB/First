import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const access = vi.hoisted(() => ({
  user: { id: 'u1' },
  guest: false,
  profile: { userId: 'u1', roles: ['trainer'] },
  ownerId: 'u1',
  error: null,
  message: null,
}));

vi.mock('../../store/useStore.js', () => ({
  useStore: selector => selector({ user: access.user, isGuest: () => access.guest }),
}));
vi.mock('../../store/useCollaboration.js', () => ({
  useCollaboration: selector => selector({
    profile: access.profile,
    ownerId: access.ownerId,
    error: access.error,
    message: access.message,
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
    error: null,
    message: null,
  });
});

const renderGuard = () => renderToStaticMarkup(
  <MemoryRouter><PersonalGuard><span>privileged</span></PersonalGuard></MemoryRouter>,
);

const protectedRoutes = [
  '/personal',
  '/personal/alunos',
  '/personal/alunos/c1',
  '/personal/agenda',
  '/personal/financeiro',
];

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

  it.each(protectedRoutes.flatMap(path => [
    [path, null],
    [path, { userId: 'u1', roles: ['student'] }],
  ]))('fails closed on %s after an error without a trainer profile', (path, profile) => {
    access.profile = profile;
    access.error = 'network failed';
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={[path]}>
        <PersonalGuard><span>privileged</span></PersonalGuard>
      </MemoryRouter>,
    );

    expect(markup).not.toContain('privileged');
    expect(markup).toContain('role="alert"');
  });

  it('redirects away from the personal area after explicit permission revocation', () => {
    access.profile = null;
    access.error = 'forbidden';
    access.message = 'PermissÃ£o revogada';
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/personal/alunos/c1/medidas']}>
        <PersonalGuard><span>privileged</span></PersonalGuard>
      </MemoryRouter>,
    );

    expect(markup).not.toContain('privileged');
    expect(markup).not.toContain('role="alert"');
  });
});
