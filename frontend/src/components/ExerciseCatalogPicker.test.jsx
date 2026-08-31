import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ hook: 0, slots: [], setters: [] }))

vi.mock('react', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    useState: initial => {
      const index = state.hook++
      if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial
      const setter = vi.fn(next => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      })
      state.setters[index] = setter
      return [state.slots[index], setter]
    },
  }
})

vi.mock('../lib/i18n.js', () => ({
  exerciseName: exercise => ({
    press: 'Supino reto com barra',
    row: 'Remada sentada na polia',
    squat: 'Agachamento com halteres',
  })[exercise.id] || exercise.n,
  t: value => ({
    All: 'Todos',
    'Any equipment': 'Qualquer equipamento',
    chest: 'Peitoral',
    back: 'Costas',
    'upper legs': 'Pernas',
    barbell: 'Barra',
    cable: 'Polia / cabo',
    dumbbell: 'Halteres',
    'Search exercises…': 'Pesquisar exercícios…',
  })[value] || value,
}))

vi.mock('./Media.jsx', () => ({
  Thumb: ({ ex }) => <span data-thumb={ex.id} />,
}))

import ExerciseCatalogPicker from './ExerciseCatalogPicker.jsx'

const EXERCISES = Object.freeze([
  Object.freeze({ id: 'press', n: 'barbell bench press', bp: 'chest', tg: 'chest', eq: 'barbell', img: 'press.webp' }),
  Object.freeze({ id: 'row', n: 'cable seated row', bp: 'back', tg: 'back', eq: 'cable', img: 'row.webp' }),
  Object.freeze({ id: 'squat', n: 'dumbbell squat', bp: 'upper legs', tg: 'upper legs', eq: 'dumbbell', img: 'squat.webp' }),
])

function pickerHarness(props = {}) {
  state.slots = []
  state.setters = []
  return {
    render() {
      state.hook = 0
      const element = ExerciseCatalogPicker({
        exercises: EXERCISES,
        selectedIds: [],
        onChange: () => {},
        searchName: 'ai-equipment-search',
        ...props,
      })
      return { element, markup: renderToStaticMarkup(element) }
    },
  }
}

function findElements(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    node.forEach(child => findElements(child, predicate, found))
    return found
  }
  if (predicate(node)) found.push(node)
  if (typeof node.type === 'function') {
    findElements(node.type(node.props), predicate, found)
    return found
  }
  const children = Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]
  children.forEach(child => findElements(child, predicate, found))
  return found
}

describe('ExerciseCatalogPicker shared browser', () => {
  beforeEach(() => {
    state.hook = 0
    state.slots = []
    state.setters = []
  })

  it('reuses the exercise-list visual language with search, filters and thumbnails', () => {
    const { markup } = pickerHarness().render()

    expect(markup).toContain('class="exercise-catalog-picker')
    expect(markup).toContain('class="search"')
    expect(markup).toContain('name="ai-equipment-search"')
    expect(markup).toContain('placeholder="Pesquisar exercícios…"')
    expect(markup).toContain('class="chips"')
    expect(markup).toContain('class="list"')
    expect(markup).toContain('class="item')
    expect(markup.match(/data-thumb=/g)).toHaveLength(3)
  })

  it('searches localized names and filters by body group and equipment', () => {
    const search = pickerHarness()
    const searchInput = findElements(search.render().element, node => node.type === 'input' && node.props?.name === 'ai-equipment-search')[0]
    expect(searchInput).toBeDefined()
    searchInput.props.onChange({ target: { value: 'supino' } })
    const searched = search.render().markup
    expect(searched).toContain('Supino reto com barra')
    expect(searched).not.toContain('Remada sentada na polia')
    expect(searched).not.toContain('Agachamento com halteres')

    const group = pickerHarness()
    const back = findElements(group.render().element, node => node.type === 'button' && node.props?.children === 'Costas')[0]
    expect(back).toBeDefined()
    back.props.onClick()
    const byGroup = group.render().markup
    expect(byGroup).toContain('Remada sentada na polia')
    expect(byGroup).not.toContain('Supino reto com barra')

    const equipment = pickerHarness()
    const dumbbell = findElements(equipment.render().element, node => node.type === 'button' && node.props?.children === 'Halteres')[0]
    expect(dumbbell).toBeDefined()
    dumbbell.props.onClick()
    const byEquipment = equipment.render().markup
    expect(byEquipment).toContain('Agachamento com halteres')
    expect(byEquipment).not.toContain('Remada sentada na polia')
  })

  it('shows Portuguese catalogue labels instead of raw dataset terms', () => {
    const { markup } = pickerHarness().render()

    for (const label of ['Todos', 'Qualquer equipamento', 'Peitoral', 'Costas', 'Pernas', 'Barra', 'Polia / cabo', 'Halteres']) {
      expect(markup).toContain(label)
    }
    expect(markup).not.toContain('barbell bench press')
    expect(markup).not.toContain('cable seated row')
  })

  it('adds and removes exercise ids without mutating the received selection', () => {
    const selectedIds = Object.freeze(['row'])
    const onChange = vi.fn()
    const { element } = pickerHarness({ selectedIds, onChange }).render()
    const choices = findElements(element, node => node.type === 'button' && typeof node.props?.['data-exercise-id'] === 'string')
    const add = choices.find(node => node.props['data-exercise-id'] === 'press')
    const remove = choices.find(node => node.props['data-exercise-id'] === 'row')

    expect(add).toBeDefined()
    expect(remove).toBeDefined()
    add.props.onClick()
    remove.props.onClick()

    expect(selectedIds).toEqual(['row'])
    expect(onChange).toHaveBeenNthCalledWith(1, ['row', 'press'])
    expect(onChange.mock.calls[0][0]).not.toBe(selectedIds)
    expect(onChange).toHaveBeenNthCalledWith(2, [])
  })
})
