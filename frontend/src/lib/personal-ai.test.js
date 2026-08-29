import { describe, expect, it } from 'vitest'

import { personalAiGrants } from './personal-ai.js'

describe('Personal AI grant projection', () => {
  it('uses only the active server-projected connection grants', () => {
    const connections = [
      { trainerId: 'trainer', studentId: 'student', status: 'ended', grants: { trainingProfileWrite: true, aiPlanRead: true } },
      { trainerId: 'trainer', studentId: 'student', status: 'active', grants: { trainingProfileWrite: true, aiPlanRead: false } },
    ]
    expect(personalAiGrants(connections, 'trainer', 'student')).toEqual({ trainingProfileWrite: true, aiPlanRead: false })
    expect(personalAiGrants(connections, 'other', 'student')).toEqual({ trainingProfileWrite: false, aiPlanRead: false })
  })
})
