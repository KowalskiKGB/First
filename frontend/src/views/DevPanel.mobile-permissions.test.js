import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fromHere = path => fileURLToPath(new URL(path, import.meta.url))

describe('in-use mobile location permissions', () => {
  it('declares only coarse and fine Android location access', () => {
    const manifest = readFileSync(fromHere('../../android/app/src/main/AndroidManifest.xml'), 'utf8')
    const locationPermissions = [...manifest.matchAll(/android\.permission\.[A-Z_]*LOCATION/g)].map(match => match[0])

    expect(locationPermissions).toEqual([
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
    ])
    expect(manifest).not.toContain('ACCESS_BACKGROUND_LOCATION')
  })

  it('explains foreground-only location usage to iOS users in pt-BR', () => {
    const plist = readFileSync(fromHere('../../ios/App/App/Info.plist'), 'utf8')

    expect(plist).toContain('<key>NSLocationWhenInUseUsageDescription</key>')
    expect(plist).toContain('localiza\u00e7\u00e3o')
    expect(plist).toContain('academias')
    expect(plist).not.toContain('NSLocationAlways')
  })
})
