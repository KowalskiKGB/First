import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./Icon.jsx', () => ({ default: ({ name }) => <i data-icon={name} /> }))
vi.mock('../lib/glyphs.js', () => ({ glyphOf: () => 'dumbbell' }))

import SessionOptions from './SessionOptions.jsx'

describe('SessionOptions', () => {
  it('renders every simultaneous session as a keyboard-accessible choice with source badges', () => {
    const options = [
      { routineId: 'manual', routine: { name: 'Meu treino', emoji: 'dumbbell', ex: [] }, sourceType: 'manual', label: 'Manual', preferred: false },
      { routineId: 'personal', routine: { name: 'Treino A', emoji: 'clipboard', ex: [] }, sourceType: 'personal', label: 'Hipertrofia', preferred: true },
      { routineId: 'ai', routine: { name: 'Treino IA', emoji: 'sparkles', ex: [] }, sourceType: 'ai', label: 'Plano IA v3', preferred: false },
    ]

    const markup = renderToStaticMarkup(<SessionOptions options={options} onSelect={() => {}} />)

    expect(markup.match(/<button/g)).toHaveLength(3)
    expect(markup).toContain('Meu treino')
    expect(markup).toContain('Treino A')
    expect(markup).toContain('Treino IA')
    expect(markup).toContain('Manual')
    expect(markup).toContain('Personal')
    expect(markup).toContain('IA')
    expect(markup).toContain('Preferido')

    const onSelect = vi.fn()
    const tree = SessionOptions({ options, onSelect })
    tree.props.children[0].props.onClick()
    expect(onSelect).toHaveBeenCalledWith(options[0])
  })
})
