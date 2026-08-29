import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

it('renders the Personal portal for an authenticated trainer inside Capacitor', async () => {
  vi.resetModules();
  vi.doMock('../../lib/mobile.js', () => ({ MOBILE: true }));
  vi.doMock('../../store/useStore.js', () => ({
    useStore: selector => selector({ user: { id: 'u1' }, isGuest: () => false }),
  }));
  vi.doMock('../../store/useCollaboration.js', () => ({
    useCollaboration: selector => selector({
      profile: { userId: 'u1', roles: ['student', 'trainer'] },
      ownerId: 'u1',
      loading: false,
      error: null,
      message: null,
      context: 'trainer',
      setContext: vi.fn(),
      load: vi.fn(),
    }),
  }));
  const PersonalGuard = (await import('./PersonalGuard.jsx')).default;

  const markup = renderToStaticMarkup(
    <MemoryRouter><PersonalGuard><span>painel personal</span></PersonalGuard></MemoryRouter>,
  );

  expect(markup).toContain('painel personal');
});
