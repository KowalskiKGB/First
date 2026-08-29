import { describe, expect, it } from 'vitest'
import { bioLabel } from './api.js'

describe('passkey biometric label', () => {
  it('follows the app language, whose default is Brazilian Portuguese', () => {
    expect(bioLabel()).toMatch(/biometria|impressão digital/)
    expect(bioLabel('en')).toMatch(/fingerprint|Face ID|Touch ID/)
  })
})
