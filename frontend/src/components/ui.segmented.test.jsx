import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Segmented } from './ui.jsx'

const OPTIONS = [
  { value: 'first', label: 'Primeira' },
  { value: 'second', label: 'Segunda' }
]

describe('Segmented', () => {
  it('has no visual selection until its controlled value matches an option', () => {
    const neutral = renderToStaticMarkup(<Segmented options={OPTIONS} value={null} onChange={vi.fn()} />)
    expect(neutral).not.toContain('seg-sel')
    expect(neutral.match(/aria-pressed="false"/g)).toHaveLength(2)

    const selected = renderToStaticMarkup(<Segmented options={OPTIONS} value="second" onChange={vi.fn()} />)
    expect(selected).toContain('seg-sel')
    expect(selected).toContain('--i:1')
    expect(selected).toContain('aria-pressed="true"')
  })
})
