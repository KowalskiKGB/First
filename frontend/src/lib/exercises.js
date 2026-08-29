import { EXDB } from './exercises-data.js'
import { exerciseName, t } from './i18n.js'

export { EXDB }
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...EXDB]

// Search remains bilingual: people can use either the canonical dataset term or the
// localized gym vocabulary, plus translated body-part/equipment/muscle labels.
export const searchKey = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase()

export const exerciseSearchText = ex => searchKey([
  ex?.n,
  exerciseName(ex),
  ex?.bp && t(ex.bp),
  ex?.eq && t(ex.eq),
  ex?.tg && t(ex.tg),
  ...(Array.isArray(ex?.mg) ? ex.mg : ex?.mg ? [ex.mg] : []).map(t),
  ...(ex?.sm || []).map(t),
  ex?.desc,
].filter(Boolean).join(' '))

export const exerciseMatchesQuery = (ex, query) => {
  const terms = searchKey(query).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = exerciseSearchText(ex)
  return terms.every(term => haystack.includes(term))
}

// Exercise media is not covered by the dataset's MIT license. It stays off unless a deployer
// explicitly enables media they are licensed to use and supplies the matching files or URLs.
export const mediaEnabled = import.meta.env.VITE_EXERCISE_MEDIA === '1'
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'media/img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'media/gif/'
export const imgSrc = ex => mediaEnabled && ex?.img ? IMG_BASE + ex.img : null
export const gifSrc = ex => mediaEnabled && ex?.gif ? GIF_BASE + ex.gif : null

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
