import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  sheets: [],
  dialogs: [],
  cleanups: [],
  documentListeners: new Map(),
  closeSheet: vi.fn(),
  runEffect(effect) {
    const cleanup = effect()
    if (typeof cleanup === 'function') this.cleanups.push(cleanup)
  },
  makeRef(initial) {
    return { current: initial === null ? this.dialogs.shift() : initial }
  },
}))

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    useEffect: effect => harness.runEffect(effect),
    useRef: initial => harness.makeRef(initial),
  }
})

vi.mock('../store/useUI.js', () => ({
  useUI: selector => selector({ sheets: harness.sheets, closeSheet: harness.closeSheet }),
}))

import Modals from './Modals.jsx'

class FakeHTMLElement {
  constructor({ controls = [], heading = null, hidden = false, visible = true } = {}) {
    this.attributes = hidden ? { 'aria-hidden': 'true' } : {}
    this.controls = controls
    this.heading = heading
    this.isConnected = true
    this.listeners = new Map()
    this.scrollTop = 0
    this.style = {}
    this.visible = visible
  }

  addEventListener(type, listener) { this.listeners.set(type, listener) }
  contains(element) { return element === this || this.controls.includes(element) }
  focus() { document.activeElement = this }
  getAttribute(name) { return this.attributes[name] || null }
  getAttributeNames() { return Object.keys(this.attributes) }
  getClientRects() { return this.visible ? [{}] : [] }
  querySelector() { return this.heading }
  querySelectorAll() { return this.controls }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type) }
  setAttribute(name, value) { this.attributes[name] = value }
}

const keyEvent = (key, shiftKey = false) => ({
  key,
  shiftKey,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
})

const sheet = (id, options = {}) => ({
  id,
  kind: options.kind || 'sheet',
  locked: options.locked === true,
  render: vi.fn(close => <div data-close={typeof close}><span>Conteúdo</span></div>),
})

const renderSheets = () => {
  const root = Modals()
  if (!root) return { root, wrappers: [] }
  const elements = Array.isArray(root.props.children) ? root.props.children : [root.props.children]
  return { root, wrappers: elements.map(element => element.type(element.props)) }
}

const dialogElementOf = wrapper => wrapper.props.children[1]
const backdropOf = wrapper => wrapper.props.children[0]
const keydown = () => [...(harness.documentListeners.get('keydown') || [])].at(-1)
const finishEffects = () => {
  for (const cleanup of [...harness.cleanups].reverse()) cleanup()
  harness.cleanups = []
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.sheets = []
  harness.dialogs = []
  harness.cleanups = []
  harness.documentListeners = new Map()
  harness.closeSheet.mockReset().mockImplementation(id => {
    harness.sheets = harness.sheets.filter(item => item.id !== id)
  })

  const opener = new FakeHTMLElement()
  const fakeDocument = {
    activeElement: opener,
    body: { style: {} },
    addEventListener: vi.fn((type, listener) => {
      const listeners = harness.documentListeners.get(type) || new Set()
      listeners.add(listener)
      harness.documentListeners.set(type, listeners)
    }),
    removeEventListener: vi.fn((type, listener) => harness.documentListeners.get(type)?.delete(listener)),
  }
  vi.stubGlobal('HTMLElement', FakeHTMLElement)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', { scrollY: 32, scrollTo: vi.fn() })
})

afterEach(() => {
  finishEffects()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Modals behavior', () => {
  it('renders nothing without sheets', () => {
    expect(Modals()).toBeNull()
    expect(document.body.style).toEqual({})
  })

  it('labels the dialog, focuses the first visible control, traps focus and restores the opener', () => {
    const opener = document.activeElement
    const layoutHidden = new FakeHTMLElement({ visible: false })
    const ariaHidden = new FakeHTMLElement({ hidden: true })
    const first = new FakeHTMLElement()
    const last = new FakeHTMLElement()
    const heading = { id: '' }
    const dialog = new FakeHTMLElement({ controls: [layoutHidden, ariaHidden, first, last], heading })
    harness.sheets = [sheet('bottom')]
    harness.dialogs = [dialog]

    const { wrappers } = renderSheets()
    const renderedDialog = dialogElementOf(wrappers[0])

    expect(renderedDialog.props.role).toBe('dialog')
    expect(renderedDialog.props['aria-modal']).toBe('true')
    expect(renderedDialog.props.tabIndex).toBe(-1)
    expect(heading.id).toBe('sheet-title-bottom')
    expect(dialog.attributes['aria-labelledby']).toBe(heading.id)
    expect(document.activeElement).toBe(first)
    expect(document.body.style).toMatchObject({ position: 'fixed', top: '-32px', width: '100%' })

    const shiftTab = keyEvent('Tab', true)
    keydown()(shiftTab)
    expect(shiftTab.preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(last)

    const tab = keyEvent('Tab')
    keydown()(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(first)

    const escape = keyEvent('Escape')
    keydown()(escape)
    expect(harness.closeSheet).toHaveBeenCalledWith('bottom')
    expect(escape.preventDefault).toHaveBeenCalledOnce()
    expect(escape.stopPropagation).toHaveBeenCalledOnce()

    finishEffects()
    expect(document.activeElement).toBe(opener)
    expect(document.body.style).toEqual({ position: '', top: '', left: '', right: '', width: '' })
    expect(window.scrollTo).toHaveBeenCalledWith(0, 32)
  })

  it('keeps a locked headingless center dialog open and focuses the dialog itself', () => {
    const dialog = new FakeHTMLElement()
    harness.sheets = [sheet('locked', { kind: 'center', locked: true })]
    harness.dialogs = [dialog]

    const { wrappers } = renderSheets()
    const renderedDialog = dialogElementOf(wrappers[0])

    expect(renderedDialog.props.className).toBe('center')
    expect(renderedDialog.props['aria-label']).toBe('Diálogo')
    expect(dialog.attributes['aria-labelledby']).toBeUndefined()
    expect(document.activeElement).toBe(dialog)

    const tab = keyEvent('Tab')
    keydown()(tab)
    expect(tab.preventDefault).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(dialog)

    const escape = keyEvent('Escape')
    keydown()(escape)
    backdropOf(wrappers[0]).props.onClick()
    expect(escape.preventDefault).toHaveBeenCalledOnce()
    expect(harness.closeSheet).not.toHaveBeenCalled()
  })

  it('marks only the top stacked sheet as modal and closes that sheet first', () => {
    const lowerControl = new FakeHTMLElement()
    const lowerDialog = new FakeHTMLElement({ controls: [lowerControl], heading: { id: 'lower-title' } })
    const topControl = new FakeHTMLElement()
    const topDialog = new FakeHTMLElement({ controls: [topControl], heading: { id: '' } })
    document.activeElement = lowerControl
    harness.sheets = [sheet('lower'), sheet('top', { kind: 'center' })]
    harness.dialogs = [lowerDialog, topDialog]

    const { wrappers } = renderSheets()
    const lower = dialogElementOf(wrappers[0])
    const top = dialogElementOf(wrappers[1])

    expect(lower.props['aria-hidden']).toBe('true')
    expect(lower.props['aria-modal']).toBeUndefined()
    expect(top.props['aria-modal']).toBe('true')
    expect(document.activeElement).toBe(topControl)

    keydown()(keyEvent('Escape'))
    expect(harness.closeSheet).toHaveBeenLastCalledWith('top')
    expect(harness.sheets.map(item => item.id)).toEqual(['lower'])

    finishEffects()
    expect(document.activeElement).toBe(lowerControl)
  })

  it('handles swipe thresholds, locked sheets and controls that opt out of dragging', () => {
    const dialog = new FakeHTMLElement()
    harness.sheets = [sheet('swipe')]
    harness.dialogs = [dialog]
    const { wrappers } = renderSheets()
    const renderedDialog = dialogElementOf(wrappers[0])
    const move = dialog.listeners.get('touchmove')
    const target = { closest: vi.fn(() => null) }

    renderedDialog.props.onTouchStart({ target, touches: [{ clientY: 10 }] })
    const moveEvent = { touches: [{ clientY: 120 }], preventDefault: vi.fn() }
    move(moveEvent)
    expect(moveEvent.preventDefault).toHaveBeenCalledOnce()
    expect(dialog.style.transform).toBe('translateY(110px)')
    renderedDialog.props.onTouchEnd()
    vi.advanceTimersByTime(180)
    expect(harness.closeSheet).toHaveBeenCalledWith('swipe')

    finishEffects()
    harness.closeSheet.mockClear()
    const lockedDialog = new FakeHTMLElement()
    harness.sheets = [sheet('locked-swipe', { locked: true })]
    harness.dialogs = [lockedDialog]
    const lockedRendered = dialogElementOf(renderSheets().wrappers[0])
    const lockedMove = lockedDialog.listeners.get('touchmove')

    lockedRendered.props.onTouchStart({ target, touches: [{ clientY: 20 }] })
    lockedMove({ touches: [{ clientY: 130 }], preventDefault: vi.fn() })
    lockedRendered.props.onTouchEnd()
    vi.advanceTimersByTime(180)
    expect(harness.closeSheet).not.toHaveBeenCalled()
    expect(lockedDialog.style.transform).toBe('')

    const optedOut = { closest: vi.fn(() => true) }
    lockedRendered.props.onTouchStart({ target: optedOut, touches: [{ clientY: 20 }] })
    lockedRendered.props.onTouchEnd()
    expect(optedOut.closest).toHaveBeenCalledWith('input[type=range], [data-nodrag]')
  })
})
