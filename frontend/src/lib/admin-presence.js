const accessDateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const timestamp = value => {
  if (!value) return null
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const relativeAccess = (value, now = Date.now()) => {
  const seenAt = timestamp(value)
  if (seenAt === null) return null
  const seconds = Math.max(0, Math.floor((now - seenAt) / 1000))
  if (seconds < 60) return 'menos de 1 min'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`
  const days = Math.floor(seconds / 86400)
  if (days < 30) return `${days} ${days === 1 ? 'dia' : 'dias'}`
  const months = Math.floor(days / 30)
  if (days < 365) return `${months} ${months === 1 ? 'mês' : 'meses'}`
  const years = Math.floor(days / 365)
  return `${years} ${years === 1 ? 'ano' : 'anos'}`
}

export const accessDate = value => {
  const seenAt = timestamp(value)
  return seenAt === null ? 'Sem registro' : accessDateFormatter.format(seenAt)
}

export const accountPresence = (account, now = Date.now()) => {
  if (account?.disabled) return 'Conta desativada'
  if (account?.online) return 'Online agora'
  const elapsed = relativeAccess(account?.lastAccessAt ?? account?.lastLoginAt, now)
  return elapsed ? `Offline há ${elapsed}` : 'Ainda não acessou'
}
