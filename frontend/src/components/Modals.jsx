import { useEffect, useRef } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const focusableWithin = root => [...root.querySelectorAll(FOCUSABLE)].filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet, active }) {
  const closeSheet = useUI(state => state.closeSheet)
  const ref = useRef(null)
  const drag = useRef({ startY: null, delta: 0 })
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement)
  const titleId = `sheet-title-${sheet.id}`

  const onTouchStart = e => {
    const el = ref.current
    // a gesture that begins on a slider (or opted-out control) belongs to that control,
    // not to the sheet's swipe-to-dismiss — so it keeps working while you drag
    if (e.target.closest && e.target.closest('input[type=range], [data-nodrag]')) {
      drag.current = { startY: null, delta: 0 }
      return
    }
    drag.current = { startY: el.scrollTop <= 0 ? e.touches[0].clientY : null, delta: 0 }
  }
  const onTouchMove = e => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    d.delta = e.touches[0].clientY - d.startY
    if (d.delta > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      el.style.transition = 'none'
      el.style.transform = `translateY(${d.delta}px)`
    } else d.delta = 0
  }
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    el.style.transition = 'transform .2s'
    if (d.delta > 90 && !sheet.locked) { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    else el.style.transform = ''
    d.startY = null
  }

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el || sheet.kind === 'center') return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [])

  const close = () => closeSheet(sheet.id)
  useEffect(() => {
    const dialog = ref.current
    if (!active || !dialog) return

    const heading = dialog.querySelector('h1, h2, h3')
    if (heading) {
      heading.id ||= titleId
      dialog.setAttribute('aria-labelledby', heading.id)
    }
    const [first] = focusableWithin(dialog)
    const initialTarget = first || dialog
    initialTarget.focus()

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        if (!sheet.locked) closeSheet(sheet.id)
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.key !== 'Tab') return

      const controls = focusableWithin(dialog)
      if (!controls.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [active, closeSheet, sheet.id, sheet.locked, titleId])

  useEffect(() => () => {
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus()
  }, [])

  const dialogProps = {
    ref,
    role: 'dialog',
    'aria-modal': active ? 'true' : undefined,
    'aria-hidden': active ? undefined : 'true',
    'aria-label': 'Diálogo',
    tabIndex: -1,
  }
  if (sheet.kind === 'center') {
    return (
      <div>
        <button type="button" className="mback" aria-label={t('Close')} disabled={sheet.locked} onClick={() => { if (!sheet.locked) close() }} />
        <div className="center" {...dialogProps}>{sheet.render(close)}</div>
      </div>
    )
  }
  return (
    <div>
      <button type="button" className="mback" aria-label={t('Close')} disabled={sheet.locked} onClick={() => { if (!sheet.locked) close() }} />
      <div className="sheet" {...dialogProps} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="grab" />
        {sheet.render(close)}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      b.position = b.top = b.left = b.right = b.width = ''
      window.scrollTo(0, y)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open">
      {sheets.map((s, index) => <Sheet key={s.id} sheet={s} active={index === sheets.length - 1} />)}
    </div>
  )
}
