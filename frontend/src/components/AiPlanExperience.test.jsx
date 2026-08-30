import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/i18n.js', () => ({
  dateLocale: () => 'en-GB', exerciseName: exercise => exercise?.n || '',
  t: (value, ...args) => args.reduce((text, arg, index) => text.replaceAll(`{${index}}`, arg), value),
}))
vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
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
    expect(markup).toContain('Current weight')
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
})
