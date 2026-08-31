import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'en-GB', exerciseName: exercise => exercise?.n || '',
  t: (value, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), value),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('./Media.jsx', () => ({ Thumb: ({ ex }) => <span data-thumb={ex.id} /> }))
vi.mock('./ui.jsx', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  NumberField: props => <input name={props.name} />,
  SearchField: props => <input name={props.name} />,
  Segmented: () => <div />,
  TextArea: props => <textarea name={props.name} />,
  TextField: props => <input name={props.name} />,
}))

import { AiPlanOverview, AiWizard } from './AiPlanExperience.jsx'

const completeDraft = {
  ageBand: 'adult', heightCm: 170, weight: 70, waistCm: '', chestCm: '', hipCm: '', armCm: '', thighCm: '', calfCm: '',
  goal: 'Força', experience: 'intermediario', availableDays: [1, 3, 5], minutesPerSession: 50, focusAreas: [],
  gymName: 'Academia', genericEquipment: ['dumbbell'], specificMachines: [], favoriteExerciseIds: [], avoidedExerciseIds: [],
  limitations: '', acuteRisk: false, medicalRestriction: false, consent: true, guardianConsent: false,
}

describe('student AI product experience', () => {
  it('presents the applied plan, stale warning and managed actions', () => {
    const markup = renderToStaticMarkup(<AiPlanOverview
      plan={{ version: 3, provider: 'openai', model: 'gpt-5', justification: 'Treino equilibrado', appliedAt: '2026-08-29T12:00:00Z' }}
      stale status={{ configured: true }} onOpen={() => {}} onRollback={() => {}} onCopy={() => {}} canRollback
    />)
    expect(markup).toContain('IA')
    expect(markup).toContain('Your workout can be updated')
    expect(markup).toContain('Undo generation')
    expect(markup).toContain('Copy and customize')
    expect(markup).toContain('Treino equilibrado')
  })

  it('opens on a labelled four-step flow with current-step semantics', () => {
    const markup = renderToStaticMarkup(<AiWizard draft={completeDraft} onDraft={() => {}} onClose={() => {}} onSubmit={() => {}} busy={false} />)
    expect(markup).toContain('Step 1 of 4')
    expect(markup).toContain('Data and measurements')
    expect(markup).toContain('aria-current="step"')
    expect(markup).toContain('Height (cm)')
    expect(markup).toContain('Current weight (kg)')

    const pounds = renderToStaticMarkup(<AiWizard {...{ draft: completeDraft, onDraft: () => {}, onClose: () => {}, onSubmit: () => {}, busy: false }} unit="lb" />)
    expect(pounds).toContain('Current weight (lb)')
  })

  it('shows a contextual load error with an explicit retry instead of provider absence copy', () => {
    const markup = renderToStaticMarkup(<AiPlanOverview
      plan={null} status={null} error="Could not load AI workout data."
      onRetry={() => {}} onOpen={() => {}} onRollback={() => {}} onCopy={() => {}}
    />)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Could not load AI workout data.')
    expect(markup).toContain('Try again')
    expect(markup).not.toContain('AI generation will be available after a provider is configured by the administrator.')
  })

  it('distinguishes loading, configured and unavailable provider states', () => {
    const props = { plan: null, onRetry: () => {}, onOpen: () => {}, onRollback: () => {}, onCopy: () => {} }
    const loading = renderToStaticMarkup(<AiPlanOverview {...props} status={null} />)
    const configured = renderToStaticMarkup(<AiPlanOverview {...props} status={{ configured: true }} />)
    const unavailable = renderToStaticMarkup(<AiPlanOverview {...props} status={{ configured: false }} />)

    expect(loading).not.toContain('Set up my AI workout')
    expect(loading).not.toContain('AI generation will be available')
    expect(configured).toContain('Complete four short steps')
    expect(configured).toContain('Set up my AI workout')
    expect(unavailable).toContain('AI generation will be available')
    expect(unavailable).toMatch(/<button[^>]*disabled=""[^>]*>Set up my AI workout/)
  })

  it('shows active and failed generation states with safe fallback copy', () => {
    const props = { plan: null, status: { configured: true }, onOpen: () => {}, onRollback: () => {}, onCopy: () => {} }
    const queued = renderToStaticMarkup(<AiPlanOverview {...props} job={{ status: 'queued' }} />)
    const failed = renderToStaticMarkup(<AiPlanOverview {...props} job={{ status: 'failed', publicError: 'Falha segura.' }} />)
    const fallback = renderToStaticMarkup(<AiPlanOverview {...props} job={{ status: 'failed' }} />)

    expect(queued).toContain('role="status"')
    expect(queued).toContain('Queued')
    expect(queued).toMatch(/<button[^>]*disabled=""[^>]*>Set up my AI workout/)
    expect(failed).toContain('Falha segura.')
    expect(fallback).toContain('Generation failed. Your previous plan is still active.')
  })

  it('keeps an undated applied plan readable without exposing unavailable rollback', () => {
    const markup = renderToStaticMarkup(<AiPlanOverview
      plan={{ version: 1, provider: 'gemini', model: 'gemini-test', justification: 'Plano inicial.', appliedAt: null }}
      status={{ configured: true }} onOpen={() => {}} onRollback={() => {}} onCopy={() => {}} canRollback={false}
    />)

    expect(markup).toContain('Plano inicial.')
    expect(markup).toContain('Review data and generate again')
    expect(markup).not.toContain('Undo generation')
    expect(markup).toContain('<time></time>')
  })
})
