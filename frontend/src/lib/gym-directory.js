const normalizedText = value => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .trim()

const uniqueStrings = (values, limit = 200) => [...new Set(
  (Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => value.trim()),
)].slice(0, limit)

const BRAZIL_STATE_CODES = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

export const gymListPath = () => '/api/gyms?limit=100'
export const gymConflictRevision = error => error?.status === 409 && Number.isInteger(error.rev) ? error.rev : null

export function createGymRequestGate() {
  let sequence = 0
  let activeController = null
  return {
    begin() {
      activeController?.abort()
      const controller = new AbortController()
      const requestId = ++sequence
      activeController = controller
      return {
        signal: controller.signal,
        isCurrent: () => requestId === sequence && activeController === controller && !controller.signal.aborted,
      }
    },
    abort() {
      activeController?.abort()
      activeController = null
      sequence += 1
    },
  }
}

export function gymInitialLocality(gyms = [], selectedGymId = '') {
  const selected = selectedGymId ? gyms.find(gym => gym?.id === selectedGymId) : null
  return { state: selected?.state || '', city: selected?.city || '' }
}

export function gymStates() {
  return [...BRAZIL_STATE_CODES]
}

export function gymCities(gyms = [], state = '', municipalities = []) {
  const wantedState = normalizedText(state)
  const registered = gyms
    .filter(gym => wantedState && normalizedText(gym?.state) === wantedState)
    .map(gym => gym?.city)
  const official = (Array.isArray(municipalities) ? municipalities : [])
    .map(entry => typeof entry === 'string' ? entry : entry?.name)
  return uniqueStrings([...official, ...registered], 6000)
    .sort((left, right) => left.localeCompare(right, 'pt-BR'))
}

export function filterGyms(gyms = [], { state = '', city = '', query = '' } = {}) {
  const wantedState = normalizedText(state)
  const wantedCity = normalizedText(city)
  const terms = normalizedText(query).split(/\s+/).filter(Boolean)
  return gyms.filter(gym => {
    if (wantedState && normalizedText(gym?.state) !== wantedState) return false
    if (wantedCity && normalizedText(gym?.city) !== wantedCity) return false
    const searchable = normalizedText([
      gym?.name, gym?.networkName, gym?.address, gym?.neighborhood, gym?.city, gym?.state,
      ...(Array.isArray(gym?.tags) ? gym.tags : []),
    ].filter(Boolean).join(' '))
    return terms.every(term => searchable.includes(term))
  })
}

const coordinate = (value, min, max) => {
  if (value == null || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function distanceKm(location, gym) {
  const latitudeA = coordinate(location?.latitude, -90, 90)
  const longitudeA = coordinate(location?.longitude, -180, 180)
  const latitudeB = coordinate(gym?.latitude, -90, 90)
  const longitudeB = coordinate(gym?.longitude, -180, 180)
  if ([latitudeA, longitudeA, latitudeB, longitudeB].some(value => value === null)) {
    return Number.isFinite(Number(gym?.distanceKm)) ? Number(gym.distanceKm) : null
  }
  const radians = Math.PI / 180
  const a = Math.sin((latitudeB - latitudeA) * radians / 2) ** 2
    + Math.cos(latitudeA * radians) * Math.cos(latitudeB * radians)
    * Math.sin((longitudeB - longitudeA) * radians / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const hasTag = (gym, tag) => Array.isArray(gym?.tags) && gym.tags.includes(tag)

export function rankGyms(gyms = [], { filter = 'all', location = null } = {}) {
  const ranked = (Array.isArray(gyms) ? gyms : []).map(gym => ({
    ...gym,
    ...(distanceKm(location, gym) == null ? {} : { distanceKm: Math.round(distanceKm(location, gym) * 10) / 10 }),
  }))
  const filtered = filter === 'favorites'
    ? ranked.filter(gym => hasTag(gym, 'Preferida'))
    : filter === 'trending'
      ? ranked.filter(gym => hasTag(gym, 'Em alta'))
      : filter === 'nearby'
        ? ranked.filter(gym => Number.isFinite(gym.distanceKm))
        : ranked
  return filtered.toSorted((left, right) => {
    if (filter === 'all') {
      const favorite = Number(hasTag(right, 'Preferida')) - Number(hasTag(left, 'Preferida'))
      if (favorite) return favorite
    }
    return (left.distanceKm ?? Infinity) - (right.distanceKm ?? Infinity)
      || String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR')
      || String(left.id || '').localeCompare(String(right.id || ''))
  })
}

const minutes = value => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function isGymOpen(gym, now = new Date()) {
  const entries = Array.isArray(gym?.openingHours) ? gym.openingHours : []
  const entry = entries.find(item => item?.day === now.getDay())
  if (!entry) return null
  if (entry.closed) return false
  const open = minutes(entry.open)
  const close = minutes(entry.close)
  if (open == null || close == null) return null
  const current = now.getHours() * 60 + now.getMinutes()
  return close < open ? current >= open || current < close : current >= open && current < close
}

export function gymMonogram(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'GY'
  return words.slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('pt-BR')
}

export function gymSnapshot(gym = {}) {
  return {
    id: String(gym.id || ''),
    directoryGymId: String(gym.id || ''),
    name: String(gym.name || '').trim(),
    state: String(gym.state || '').trim().toLocaleUpperCase('pt-BR'),
    city: String(gym.city || '').trim(),
    address: String(gym.address || '').trim(),
    status: ['verified', 'partner'].includes(gym.status) ? gym.status : 'unverified',
    openingHoursNote: String(gym.openingHoursNote || '').trim(),
    openingHours: (Array.isArray(gym.openingHours) ? gym.openingHours : []).map(hours => ({
      day: Number(hours.day),
      ...(hours.closed === true ? { closed: true } : {
        open: String(hours.open || ''), close: String(hours.close || ''), closed: false,
      }),
    })),
    exerciseIds: uniqueStrings(gym.exerciseIds),
  }
}
