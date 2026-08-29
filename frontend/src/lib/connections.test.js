import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONNECTION_GRANTS,
  CONNECTION_ENDPOINTS,
  connectionEndPayload,
  connectionCounterpart,
  connectionRequestPayload,
  connectionResponsePayload,
  connectionStatusLabel,
  grantLabels,
  normalizeExplicitGrants,
  requestDirection,
  requestGrants,
  responseGrants,
  sanitizeShareCode,
} from './connections.js'

const studentRequest = {
  id: 'connection-1',
  studentId: 'student-1',
  trainerId: 'trainer-1',
  requestedBy: 'student-1',
  status: 'pending',
  grants: { plansWrite: true, workoutsRead: false },
}

let Connections
let collaborationState
let accountState
const load = vi.fn()
const mutate = vi.fn()
const useCollaboration = selector => selector(collaborationState)
const useStore = selector => selector(accountState)

vi.doMock('../store/useCollaboration.js', () => ({ useCollaboration }))
vi.doMock('../store/useStore.js', () => ({ useStore }))
vi.doMock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))

beforeAll(async () => {
  ;({ default: Connections } = await import('../views/student/Connections.jsx'))
})

beforeEach(() => {
  accountState = { user: { id: 'student-1' } }
  collaborationState = {
    ownerId: 'student-1',
    context: 'student',
    profile: { userId: 'student-1', roles: ['student', 'trainer'], shareCode: 'A'.repeat(32), shareCodeExpiresAt: '2026-09-29' },
    connections: [],
    notifications: [],
    loading: false,
    error: null,
    message: null,
    load,
    mutate,
  }
})

describe('share code', () => {
  it('keeps at most 128 bits of uppercase hexadecimal input', () => {
    expect(sanitizeShareCode('  abcd-1234 5678 90ef abcd 1234 5678 90ef  '))
      .toBe('ABCD1234567890EFABCD1234567890EF')
    expect(sanitizeShareCode('GG' + 'A'.repeat(40))).toBe('A'.repeat(32))
  })
})

describe('explicit grants', () => {
  it('never grants missing, unknown, or merely truthy values', () => {
    expect(normalizeExplicitGrants({ plansWrite: true, workoutsRead: 1, unknown: true })).toEqual({
      plansWrite: true,
      workoutsRead: false,
      progressRead: false,
      measurementsWrite: false,
      liveActivityRead: false,
    })
  })

  it('sends the student choices with a student request', () => {
    expect(requestGrants('student', { workoutsRead: true })).toEqual({
      plansWrite: false,
      workoutsRead: true,
      progressRead: false,
      measurementsWrite: false,
      liveActivityRead: false,
    })
  })

  it('sends no grants with a trainer request', () => {
    expect(requestGrants('trainer', { plansWrite: true })).toEqual({})
  })

  it.each([undefined, null, '', 'admin', 'STUDENT'])('rejects invalid actor role %s before building a request', actorRole => {
    expect(() => requestGrants(actorRole, { plansWrite: true })).toThrowError('Invalid connection actor role')
    expect(() => connectionRequestPayload(actorRole, 'A'.repeat(32), { plansWrite: true }))
      .toThrowError('Invalid connection actor role')
  })

  it('lets the student explicitly choose grants when accepting a trainer request', () => {
    const trainerRequest = { ...studentRequest, requestedBy: 'trainer-1', grants: {} }
    expect(responseGrants(trainerRequest, 'student-1', { progressRead: true })).toEqual({
      plansWrite: false,
      workoutsRead: false,
      progressRead: true,
      measurementsWrite: false,
      liveActivityRead: false,
    })
  })

  it('prevents the trainer from widening grants when accepting a student request', () => {
    expect(responseGrants(studentRequest, 'trainer-1', { measurementsWrite: true })).toEqual({})
  })

  it('provides textual labels for every permission and for no permissions', () => {
    expect(CONNECTION_GRANTS).toHaveLength(5)
    expect(grantLabels({ workoutsRead: true })).toEqual(['Read completed workouts'])
    expect(grantLabels({})).toEqual(['No permissions granted'])
  })

  it('builds the exact request, response, end, and notification endpoint payloads', () => {
    expect(CONNECTION_ENDPOINTS).toEqual({
      request: '/api/connections/request',
      respond: '/api/connections/respond',
      end: '/api/connections/end',
      readNotifications: '/api/notifications/read',
    })
    expect(connectionRequestPayload('trainer', 'a '.repeat(32), { plansWrite: true })).toEqual({
      actorRole: 'trainer',
      shareCode: 'A'.repeat(32),
      grants: {},
    })
    expect(connectionRequestPayload('student', 'B'.repeat(32), { plansWrite: true })).toEqual({
      actorRole: 'student',
      shareCode: 'B'.repeat(32),
      grants: {
        plansWrite: true,
        workoutsRead: false,
        progressRead: false,
        measurementsWrite: false,
        liveActivityRead: false,
      },
    })
    expect(connectionResponsePayload(studentRequest, 'trainer-1', true, { measurementsWrite: true })).toEqual({
      connectionId: 'connection-1',
      accept: true,
      grants: {},
    })
    expect(connectionEndPayload('connection-1')).toEqual({ connectionId: 'connection-1' })
  })
})

describe('connection relationship', () => {
  it('derives the counterpart role and identifier', () => {
    expect(connectionCounterpart(studentRequest, 'student-1')).toEqual({ id: 'trainer-1', role: 'trainer' })
    expect(connectionCounterpart(studentRequest, 'trainer-1')).toEqual({ id: 'student-1', role: 'student' })
    expect(connectionCounterpart(studentRequest, 'stranger')).toBeNull()
  })

  it('only makes a pending request actionable by its counterpart', () => {
    expect(requestDirection(studentRequest, 'student-1')).toEqual({
      direction: 'outgoing',
      label: 'Sent by you',
      canRespond: false,
    })
    expect(requestDirection(studentRequest, 'trainer-1')).toEqual({
      direction: 'incoming',
      label: 'Waiting for your response',
      canRespond: true,
    })
    expect(requestDirection({ ...studentRequest, status: 'active' }, 'trainer-1').canRespond).toBe(false)
  })

  it('fails closed when requestedBy is not either participant', () => {
    expect(requestDirection({ ...studentRequest, requestedBy: 'stranger' }, 'trainer-1')).toEqual({
      direction: 'unrelated',
      label: 'Not available',
      canRespond: false,
    })
  })

  it('distinguishes a refused request from an ended active connection', () => {
    expect(connectionStatusLabel({ status: 'ended', respondedAt: '2026-08-29', endedAt: '2026-08-29' })).toBe('Refused')
    expect(connectionStatusLabel({ status: 'ended', respondedAt: '2026-08-28', endedAt: '2026-08-29' })).toBe('Ended')
  })
})

describe('connections view boundaries', () => {
  it('uses the active student context for a dual-role account', () => {
    const markup = renderToStaticMarkup(React.createElement(Connections))
    expect(markup).toContain('Choose exactly what this Personal may access')
    expect(markup).toContain('type="checkbox"')
    expect(markup).not.toContain('No permissions are requested now')
  })

  it('uses the active trainer context for a dual-role account', () => {
    collaborationState = { ...collaborationState, context: 'trainer' }
    const markup = renderToStaticMarkup(React.createElement(Connections))
    expect(markup).toContain('No permissions are requested now')
    expect(markup).not.toContain('type="checkbox"')
  })

  it('shows the fail-closed revocation state instead of a generic load error', () => {
    collaborationState = {
      ...collaborationState,
      profile: null,
      error: 'forbidden',
      message: 'Permission revoked',
    }
    const markup = renderToStaticMarkup(React.createElement(Connections))
    expect(markup).toContain('Permission revoked')
    expect(markup).not.toContain('Could not load connections')
  })
})
