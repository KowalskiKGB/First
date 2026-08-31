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
    const searchable = normalizedText([gym?.name, gym?.address, gym?.city, gym?.state].filter(Boolean).join(' '))
    return terms.every(term => searchable.includes(term))
  })
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
