import { describe, expect, it } from 'vitest'

import {
  CONNECTION_GRANTS,
  connectionCounterpart,
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

  it('distinguishes a refused request from an ended active connection', () => {
    expect(connectionStatusLabel({ status: 'ended', respondedAt: '2026-08-29', endedAt: '2026-08-29' })).toBe('Refused')
    expect(connectionStatusLabel({ status: 'ended', respondedAt: '2026-08-28', endedAt: '2026-08-29' })).toBe('Ended')
  })
})
