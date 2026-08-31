import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Library.jsx', import.meta.url), 'utf8')
const routineSource = readFileSync(new URL('./RoutineEdit.jsx', import.meta.url), 'utf8')
const sheetSource = readFileSync(new URL('../sheets.jsx', import.meta.url), 'utf8')
const modalSource = readFileSync(new URL('../components/Modals.jsx', import.meta.url), 'utf8')

describe('Library interaction semantics', () => {
  it('uses native buttons for opening custom and catalogue exercises', () => {
    expect(source).not.toMatch(/<div[^>]+className="item"[^>]+onClick=/)
    expect(source).toContain('className="item library-create-exercise"')
    expect(source).toContain('className="library-exercise-open"')
  })

  it('keeps routine, picker, history and backdrop actions keyboard reachable', () => {
    expect(routineSource).toContain('className="routine-exercise-open"')
    expect(routineSource).not.toMatch(/className=\{'item'[^}]*\}\s+onClick=/)
    expect(sheetSource).toContain('return <button type="button" className="item" onClick={onClick}>')
    expect(sheetSource).not.toMatch(/<div[^>]+className="item"[^>]+onClick=/)
    expect(modalSource.match(/<button type="button" className="mback"/g)).toHaveLength(2)
    expect(modalSource.match(/aria-label=\{t\('Close'\)\}/g)).toHaveLength(2)
  })
})
