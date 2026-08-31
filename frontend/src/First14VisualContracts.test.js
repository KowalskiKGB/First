import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('First 1.4 visual accessibility contracts', () => {
  it('keeps global icon and Dev secret controls at least 44px', () => {
    expect(css).toMatch(/\.iconbtn\{[^}]*min-width:44px[^}]*min-height:44px/s)
    expect(css).toMatch(/\.dev-login>\.btn:not\(\.primary\),\.dev-provider-card>label\+\.btn\{[^}]*min-height:44px/s)
  })

  it('fits the compact finance history inside a phone panel', () => {
    expect(css).toMatch(/@media\s*\(max-width:600px\)[\s\S]*\.money-bars-table\{[^}]*min-width:100%/)
  })
})
