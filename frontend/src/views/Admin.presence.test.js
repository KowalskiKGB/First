import { describe, expect, it } from 'vitest'

import { accessDate, accountPresence, relativeAccess } from '../lib/admin-presence.js'

describe('Admin account presence labels', () => {
  const now = Date.parse('2026-08-30T18:00:00.000Z')

  it('keeps general app presence separate from an active workout', () => {
    expect(accountPresence({ online: true, live: null }, now)).toBe('Online agora')
    expect(accountPresence({ online: false, live: { name: 'Pernas' }, lastAccessAt: now - 90_000 }, now)).toBe('Offline há 1 min')
  })

  it('shows how long an account has been offline and handles legacy accounts', () => {
    expect(accountPresence({ online: false, lastAccessAt: now - 3 * 86400000 }, now)).toBe('Offline há 3 dias')
    expect(accountPresence({ online: false, lastLoginAt: now - 86400000 }, now)).toBe('Offline há 1 dia')
    expect(accountPresence({ online: false }, now)).toBe('Ainda não acessou')
    expect(accountPresence({ disabled: true, online: true }, now)).toBe('Conta desativada')
    expect(relativeAccess('invalid', now)).toBeNull()
  })

  it('formats longer access intervals and concrete timestamps', () => {
    expect(relativeAccess(now - 45 * 86400000, now)).toBe('1 mês')
    expect(relativeAccess(now - 75 * 86400000, now)).toBe('2 meses')
    expect(relativeAccess(now - 400 * 86400000, now)).toBe('1 ano')
    expect(relativeAccess(now - 800 * 86400000, now)).toBe('2 anos')
    expect(accessDate('invalid')).toBe('Sem registro')
    expect(accessDate(now)).not.toBe('Sem registro')
  })
})
