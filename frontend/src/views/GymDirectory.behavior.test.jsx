import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hooks = vi.hoisted(() => ({
  calls: 0,
  values: [],
  setters: [],
  reset(values = []) { this.calls = 0; this.values = values; this.setters = [] },
}))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useState: initial => {
    const index = hooks.calls++
    const value = index < hooks.values.length ? hooks.values[index] : typeof initial === 'function' ? initial() : initial
    const setter = vi.fn()
    hooks.setters[index] = setter
    return [value, setter]
  },
}))
vi.mock('../lib/i18n.js', () => ({
  exerciseName: exercise => exercise.name,
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ExerciseCatalogPicker.jsx', () => ({
  default: props => <section data-picker data-search-name={props.searchName} onClick={() => props.onChange?.(['0043'])} />,
}))

import GymContributionForm from '../components/gym/GymContributionForm.jsx'
import GymDetail from '../components/gym/GymDetail.jsx'
import StarRating from '../components/gym/StarRating.jsx'

function findElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found
  if (predicate(node)) found.push(node)
  React.Children.forEach(node.props.children, child => findElements(child, predicate, found))
  return found
}

const gym = {
  id: 'gym-x', name: 'Academia X', state: 'CE', city: 'Fortaleza', address: 'Rua ABC, 123',
  tags: ['Preferida'], openingHours: [], exerciseIds: ['0043'],
}

describe('GymDetail behavior', () => {
  beforeEach(() => hooks.reset())

  it('requires login for favorite, rating and every structural contribution', () => {
    const onRequireLogin = vi.fn()
    const view = GymDetail({ gym, authenticated: false, onRequireLogin, onToggleFavorite: vi.fn(), onSubmitReview: vi.fn(), onSubmitContribution: vi.fn(), onSelect: vi.fn(), onBack: vi.fn() })

    findElements(view, element => element.props.className?.includes?.('gym-favorite'))[0].props.onClick()
    findElements(view, element => element.props.children === 'Suggest a correction')[0].props.onClick()
    findElements(view, element => element.props.children === 'Add equipment')[0].props.onClick()
    findElements(view, element => element.props.children === 'Report closure')[0].props.onClick()
    findElements(view, element => element.type === StarRating)[0].props.onChange(5)

    expect(onRequireLogin).toHaveBeenCalledTimes(5)
  })

  it('submits an accessible star rating and optional comment for an authenticated student', () => {
    hooks.reset([5, 'Ótima estrutura', ''])
    const onSubmitReview = vi.fn()
    const view = GymDetail({ gym, authenticated: true, onRequireLogin: vi.fn(), onToggleFavorite: vi.fn(), onSubmitReview, onSubmitContribution: vi.fn(), onSelect: vi.fn(), onBack: vi.fn() })
    const form = findElements(view, element => element.props.className === 'gym-review-form')[0]

    form.props.onSubmit({ preventDefault: vi.fn() })

    expect(onSubmitReview).toHaveBeenCalledWith({ rating: 5, comment: 'Ótima estrutura' })
    const stars = StarRating(findElements(view, element => element.type === StarRating)[0].props)
    expect(findElements(stars, element => element.props.type === 'radio')).toHaveLength(5)
    expect(findElements(stars, element => element.props.role === 'radiogroup')).toHaveLength(1)
  })

  it('restores navigation through the explicit back control', () => {
    const onBack = vi.fn()
    const view = GymDetail({ gym, authenticated: false, onRequireLogin: vi.fn(), onToggleFavorite: vi.fn(), onSubmitReview: vi.fn(), onSubmitContribution: vi.fn(), onSelect: vi.fn(), onBack })

    findElements(view, element => element.props['aria-label'] === 'Back to gyms')[0].props.onClick()

    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('GymContributionForm payloads', () => {
  beforeEach(() => hooks.reset())

  it('sends only the correction fields accepted by the current API contract', () => {
    hooks.reset([{ name: 'Academia X', networkName: 'Rede X', address: 'Rua Nova, 2', neighborhood: 'Centro', note: 'Endereço mudou', exerciseIds: [] }])
    const onSubmit = vi.fn()
    const form = GymContributionForm({ kind: 'correction', gym, onCancel: vi.fn(), onSubmit })

    form.props.onSubmit({ preventDefault: vi.fn() })

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Academia X', networkName: 'Rede X', address: 'Rua Nova, 2', neighborhood: 'Centro', note: 'Endereço mudou' })
  })

  it('uses the shared exercise catalog IDs for equipment and requires a closure reason', () => {
    hooks.reset([{ name: 'Hack squat', networkName: '', address: '', neighborhood: '', note: 'Sala principal', exerciseIds: ['0043'] }])
    const equipmentSubmit = vi.fn()
    const equipment = GymContributionForm({ kind: 'equipment', gym, onCancel: vi.fn(), onSubmit: equipmentSubmit })
    equipment.props.onSubmit({ preventDefault: vi.fn() })
    expect(equipmentSubmit).toHaveBeenCalledWith({ name: 'Hack squat', note: 'Sala principal', exerciseIds: ['0043'] })

    hooks.reset([{ name: '', networkName: '', address: '', neighborhood: '', note: 'Placa de encerramento na porta', exerciseIds: [] }])
    const closureSubmit = vi.fn()
    const closure = GymContributionForm({ kind: 'closure', gym, onCancel: vi.fn(), onSubmit: closureSubmit })
    closure.props.onSubmit({ preventDefault: vi.fn() })
    expect(closureSubmit).toHaveBeenCalledWith({ note: 'Placa de encerramento na porta' })
  })
})
