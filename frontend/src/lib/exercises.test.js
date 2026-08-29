import { describe, expect, it } from 'vitest'
import { gifSrc, imgSrc, mediaEnabled } from './exercises.js'

describe('optional exercise media', () => {
  it('does not request third-party media without an explicit licensed-media build flag', () => {
    const exercise = { img: 'example.jpg', gif: 'example.gif' }

    expect(mediaEnabled).toBe(false)
    expect(imgSrc(exercise)).toBeNull()
    expect(gifSrc(exercise)).toBeNull()
  })
})

