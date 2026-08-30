import { beforeAll, describe, expect, it } from 'vitest'

import { setLang } from './i18n.js'
import { reminderNotifications } from './mobile.js'

describe('reminderNotifications', () => {
  beforeAll(() => setLang('pt'))

  it('uses the session count and workout selector destination when a weekday has multiple options', () => {
    const state = {
      routines: [
        { id: 'manual', name: 'Manual' }, { id: 'personal', name: 'Personal' }, { id: 'ai', name: 'IA' },
      ],
      week: { 1: 'manual' },
      dayPlan: {},
      sourceSchedules: {
        personal: [{ sourceType: 'personal', planId: 'p1', version: 1, active: true, week: { 1: 'personal' } }],
        ai: [{ sourceType: 'ai', planId: 'a1', version: 1, active: true, week: { 1: 'ai' } }],
      },
    }

    const notifications = reminderNotifications(state, 8, 30)

    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({
      id: 101,
      body: 'Você tem 3 sessões disponíveis.',
      extra: { url: '#/workout', optionCount: 3 },
      schedule: { on: { weekday: 2, hour: 8, minute: 30 }, allowWhileIdle: true },
    })
  })
})
