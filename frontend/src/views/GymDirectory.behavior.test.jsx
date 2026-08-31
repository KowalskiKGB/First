import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  calls: 0,
  values: [],
  setters: [],
  effects: [],
  api: vi.fn(),
  dispatchEvent: vi.fn(),
  reset(values = []) {
    this.calls = 0
    this.values = values
    this.setters = []
    this.effects = []
    this.api.mockReset()
    this.dispatchEvent.mockReset()
  },
}))

vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useRef: initial => ({ current: initial }),
  useState: initial => {
    const index = harness.calls++
    const value = index < harness.values.length ? harness.values[index] : typeof initial === 'function' ? initial() : initial
    const setter = vi.fn()
    harness.setters[index] = setter
    return [value, setter]
  },
  useEffect: effect => { harness.effects.push(effect) },
  useMemo: factory => factory(),
}))

vi.mock('../lib/api.js', () => ({ api: harness.api }))
vi.mock('../lib/i18n.js', () => ({
  exerciseName: exercise => exercise.namePt || exercise.name,
  t: (message, ...args) => args.reduce((value, arg, index) => value.replaceAll(`{${index}}`, arg), message),
}))
vi.mock('../components/Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../components/ExerciseCatalogPicker.jsx', () => ({
  default: ({ onChange, selectedIds = [], readOnly = false, searchName }) => (
    <section data-picker data-selected-ids={selectedIds.join(',')} data-read-only={String(readOnly)} data-search-name={searchName} onClick={() => onChange?.(['0043'])} />
  ),
}))

import GymDirectory from './GymDirectory.jsx'

function findElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found
  if (predicate(node)) found.push(node)
  React.Children.forEach(node.props.children, child => findElements(child, predicate, found))
  return found
}

const gyms = [{
  id: 'gym-x',
  name: 'Academia X',
  state: 'CE',
  city: 'Fortaleza',
  address: 'Rua ABC, 123',
  status: 'unverified',
  openingHours: [],
  openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
  exerciseIds: ['0043'],
}]

describe('GymDirectory behavior', () => {
  beforeEach(() => {
    harness.reset()
    vi.stubGlobal('window', {
      dispatchEvent: harness.dispatchEvent,
      CustomEvent: class CustomEvent {
        constructor(type, init) {
          this.type = type
          this.detail = init?.detail
        }
      },
    })
  })

  it('opens account access instead of sending equipment requests for guests', () => {
    harness.reset([gyms, 7, 'CE', 'Fortaleza', '', 'gym-x', false])
    const view = GymDirectory({ gyms, selectedGymId: 'gym-x', authenticated: false })
    const button = findElements(view, element => element.props.children === 'Could not find your equipment? Click here to register it')[0]

    button.props.onClick()

    expect(harness.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'first:account',
      detail: { mode: 'login' },
    }))
    expect(harness.api).not.toHaveBeenCalled()
  })

  it('queues equipment suggestions using only selected catalogue exercise ids', async () => {
    harness.reset([gyms, 7, 'CE', 'Fortaleza', '', 'gym-x', true, ['0043'], 'Hack squat', 'Tem na área de pernas', false, {}, false, ''])
    harness.api.mockResolvedValue({ rev: 8 })
    const onSelect = vi.fn()
    const view = GymDirectory({ gyms, selectedGymId: 'gym-x', authenticated: true, onSelect })
    const form = findElements(view, element => element.props.className === 'gym-equipment-request')[0]
    const markup = renderToStaticMarkup(form)

    findElements(view, element => element.props.className === 'btn primary gym-select-action')[0].props.onClick()
    expect(onSelect).toHaveBeenCalledWith(gyms[0])
    expect(markup).toContain('gym-request-name')
    expect(markup).toContain('gym-request-exercise-search')
    expect(markup).toContain('gym-request-note')
    findElements(form, element => element.props.name === 'gym-request-name')[0].props.onChange({ target: { value: 'Leg press 45' } })
    findElements(form, element => element.props.name === 'gym-request-note')[0].props.onChange({ target: { value: 'Correção' } })
    findElements(form, element => element.props.searchName === 'gym-request-exercise-search')[0].props.onChange(['0043'])

    await form.props.onSubmit({ preventDefault: vi.fn() })

    expect(harness.api).toHaveBeenCalledWith('/api/gym-requests', {
      method: 'POST',
      body: JSON.stringify({
        rev: 7,
        kind: 'equipment',
        gymId: 'gym-x',
        payload: { name: 'Hack squat', note: 'Tem na área de pernas', exerciseIds: ['0043'] },
      }),
    })
    expect(harness.setters[6]).toHaveBeenCalledWith(false)
    expect(harness.setters[7]).toHaveBeenCalledWith(['0043'])
    expect(harness.setters[8]).toHaveBeenCalledWith('Leg press 45')
    expect(harness.setters[9]).toHaveBeenCalledWith('Correção')
    expect(harness.setters[13]).toHaveBeenCalledWith('Request sent for review.')
    findElements(form, element => element.props.className === 'btn' && element.props.children === 'Cancel')[0].props.onClick()
    expect(harness.setters[6]).toHaveBeenCalledWith(false)
  })

  it('queues a new gym with textual opening hours and catalogue equipment', async () => {
    harness.reset([gyms, 4, 'CE', 'Fortaleza', '', '', false, [], '', '', true, {
      name: 'Academia Nova',
      state: 'ce',
      city: 'Fortaleza',
      address: 'Rua Nova, 20',
      openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
      exerciseIds: ['0043', '0085'],
    }, false, ''])
    harness.api.mockResolvedValue({ rev: 5 })
    const view = GymDirectory({ gyms, authenticated: true })
    const form = findElements(view, element => element.props.className === 'card gym-new-request')[0]
    const markup = renderToStaticMarkup(form)

    expect(markup).toContain('gym-request-opening-hours')
    expect(markup).toContain('new-gym-exercise-search')
    findElements(form, element => element.props.name === 'gym-request-gym-name')[0].props.onChange({ target: { value: 'Academia Editada' } })
    findElements(form, element => element.props.name === 'gym-request-state')[0].props.onChange({ target: { value: 'SP' } })
    findElements(form, element => element.props.name === 'gym-request-city')[0].props.onChange({ target: { value: 'Campinas' } })
    findElements(form, element => element.props.name === 'gym-request-address')[0].props.onChange({ target: { value: 'Avenida 1' } })
    findElements(form, element => element.props.name === 'gym-request-opening-hours')[0].props.onChange({ target: { value: 'Sábado até 12:00' } })
    findElements(form, element => element.props.searchName === 'new-gym-exercise-search')[0].props.onChange(['0043'])

    await form.props.onSubmit({ preventDefault: vi.fn() })

    expect(harness.api).toHaveBeenCalledWith('/api/gym-requests', {
      method: 'POST',
      body: JSON.stringify({
        rev: 4,
        kind: 'gym',
        payload: {
          name: 'Academia Nova',
          state: 'CE',
          city: 'Fortaleza',
          address: 'Rua Nova, 20',
          openingHours: [],
          openingHoursNote: 'Segunda a sexta, 6:00 às 22:00',
          exerciseIds: ['0043', '0085'],
        },
      }),
    })
    expect(harness.setters[10]).toHaveBeenCalledWith(false)
    expect(harness.setters[11]).toHaveBeenCalled()
    expect(harness.setters[13]).toHaveBeenCalledWith('Gym request sent for review.')
    findElements(form, element => element.props.className === 'btn' && element.props.children === 'Cancel')[0].props.onClick()
    expect(harness.setters[10]).toHaveBeenCalledWith(false)
  })

  it('loads public gyms from the API without requiring authentication', async () => {
    harness.reset()
    harness.api.mockResolvedValue({ rev: 2, gyms })

    GymDirectory({ authenticated: false })
    harness.effects[0]()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(harness.api).toHaveBeenCalledWith('/api/gyms')
    expect(harness.setters[0]).toHaveBeenCalledWith(gyms)
    expect(harness.setters[1]).toHaveBeenCalledWith(2)
  })

  it('does not restore a selected gym locality over a newer user choice', async () => {
    let resolveGyms
    harness.api.mockImplementation(path => path === '/api/gyms'
      ? new Promise(resolve => { resolveGyms = resolve })
      : Promise.resolve({ municipalities: [] }))
    const view = GymDirectory({ selectedGymId: 'gym-x', authenticated: false })
    const stateSelect = findElements(view, element => element.props.name === 'gym-state')[0]

    harness.effects[0]()
    stateSelect.props.onChange({ target: { value: 'SP' } })
    resolveGyms({ rev: 2, gyms })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(harness.setters[2]).toHaveBeenCalledWith('SP')
    expect(harness.setters[2]).toHaveBeenCalledTimes(1)
    expect(harness.setters[3]).toHaveBeenCalledWith('')
    expect(harness.setters[3]).toHaveBeenCalledTimes(1)
  })

  it('loads municipalities only after a UF is selected', async () => {
    harness.reset([gyms, 7, 'CE', '', '', null, false, [], '', '', false, {
      name: '', state: '', city: '', address: '', openingHoursNote: '', exerciseIds: [],
    }, false, ''])
    const response = { uf: 'CE', municipalities: [{ id: 2304400, name: 'Fortaleza' }] }
    harness.api.mockResolvedValue(response)

    GymDirectory({ gyms, authenticated: false })
    harness.effects[2]()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(harness.api).toHaveBeenCalledWith('/api/locations/municipalities?uf=CE')
    expect(harness.setters[14]).toHaveBeenCalledWith(response.municipalities)
    expect(harness.setters[15]).toHaveBeenCalledWith('ready')
  })

  it('resets locality state without a request until a UF is selected', () => {
    harness.reset()

    GymDirectory({ gyms, authenticated: false })
    const cleanup = harness.effects[2]()

    expect(cleanup).toBeUndefined()
    expect(harness.api).not.toHaveBeenCalledWith(expect.stringContaining('/api/locations/municipalities'))
    expect(harness.setters[14]).toHaveBeenCalledWith([])
    expect(harness.setters[15]).toHaveBeenCalledWith('idle')
    expect(harness.setters[16]).toHaveBeenCalledWith('')
  })

  it('uses the safe manual fallback when loading municipalities fails', async () => {
    harness.reset([gyms, 7, 'RR'])
    harness.api.mockRejectedValue(new Error('Não foi possível carregar os municípios. Digite o município manualmente.'))

    GymDirectory({ gyms, authenticated: false })
    harness.effects[2]()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(harness.setters[14]).toHaveBeenCalledWith([])
    expect(harness.setters[15]).toHaveBeenCalledWith('error')
    expect(harness.setters[16]).toHaveBeenCalledWith('Não foi possível carregar os municípios. Digite o município manualmente.')
  })

  it('clears search and open detail whenever the locality changes', () => {
    harness.reset([gyms, 7, 'CE', 'Fortaleza', 'x', 'gym-x'])
    const view = GymDirectory({ gyms, selectedGymId: 'gym-x', authenticated: false })
    const stateSelect = findElements(view, element => element.props.name === 'gym-state')[0]
    const citySelect = findElements(view, element => element.props.name === 'gym-city')[0]

    stateSelect.props.onChange({ target: { value: 'SP' } })
    citySelect.props.onChange('Campinas')

    expect(harness.setters[2]).toHaveBeenCalledWith('SP')
    expect(harness.setters[3]).toHaveBeenCalledWith('')
    expect(harness.setters[3]).toHaveBeenCalledWith('Campinas')
    expect(harness.setters[4]).toHaveBeenCalledWith('')
    expect(harness.setters[5]).toHaveBeenCalledWith(null)
  })

  it('inherits the selected locality when an authenticated student requests a gym', () => {
    harness.reset([gyms, 7, 'CE', 'Fortaleza'])
    const view = GymDirectory({ gyms, authenticated: true })
    const button = findElements(view, element => element.props.children === 'Could not find your gym? Request its registration')[0]

    button.props.onClick()

    expect(harness.setters[13]).toHaveBeenCalledWith('')
    expect(harness.setters[11]).toHaveBeenCalledWith(expect.any(Function))
    expect(harness.setters[11].mock.calls[0][0]({ state: '', city: '' })).toMatchObject({ state: 'CE', city: 'Fortaleza' })
    expect(harness.setters[10]).toHaveBeenCalledWith(true)
  })

  it('shows a manual municipality field when the location service fails', () => {
    harness.reset([gyms, 7, 'RR', '', '', null, false, [], '', '', false, {
      name: '', state: '', city: '', address: '', openingHoursNote: '', exerciseIds: [],
    }, false, '', [], 'error', 'Digite o município manualmente.'])

    const markup = renderToStaticMarkup(<GymDirectory gyms={gyms} authenticated={false} />)

    expect(markup).toContain('name="gym-city"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Digite o município manualmente.')
    expect(markup).not.toContain('No gyms found in this location.')
  })
})
