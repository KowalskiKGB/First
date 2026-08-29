export const CONNECTION_GRANTS = Object.freeze([
  { key: 'plansWrite', label: 'Publish plans', description: 'Allows the Personal to publish future training plans.' },
  { key: 'workoutsRead', label: 'Read completed workouts', description: 'Shares completed workouts and their sets.' },
  { key: 'progressRead', label: 'Read progress', description: 'Shares adherence and progress summaries.' },
  { key: 'measurementsWrite', label: 'Record measurements', description: 'Allows the Personal to add body measurements.' },
  { key: 'liveActivityRead', label: 'See live activity', description: 'Shares activity while a workout is in progress.' },
  { key: 'trainingProfileWrite', label: 'Edit training profile', description: 'Allows the Personal to edit the training profile and gym equipment.' },
  { key: 'aiPlanRead', label: 'Read AI plans', description: 'Shares applied AI plans and their justifications.' },
])

export const CONNECTION_ENDPOINTS = Object.freeze({
  request: '/api/connections/request',
  respond: '/api/connections/respond',
  end: '/api/connections/end',
  readNotifications: '/api/notifications/read',
})

export const sanitizeShareCode = value => String(value || '')
  .toUpperCase()
  .replace(/[^A-F0-9]/g, '')
  .slice(0, 32)

export function normalizeExplicitGrants(grants) {
  return Object.fromEntries(CONNECTION_GRANTS.map(({ key }) => [key, grants?.[key] === true]))
}

function validActorRole(actorRole) {
  if (actorRole !== 'student' && actorRole !== 'trainer') throw new TypeError('Invalid connection actor role')
  return actorRole
}

export function requestGrants(actorRole, grants) {
  return validActorRole(actorRole) === 'student' ? normalizeExplicitGrants(grants) : {}
}

export function connectionRequestPayload(actorRole, shareCode, grants) {
  const role = validActorRole(actorRole)
  return { actorRole: role, shareCode: sanitizeShareCode(shareCode), grants: requestGrants(role, grants) }
}

export function responseGrants(connection, actorId, grants) {
  const studentAcceptsTrainerRequest = actorId === connection?.studentId
    && connection?.requestedBy === connection?.trainerId
  return studentAcceptsTrainerRequest ? normalizeExplicitGrants(grants) : {}
}

export const connectionResponsePayload = (connection, actorId, accept, grants) => ({
  connectionId: connection.id,
  accept: !!accept,
  grants: accept ? responseGrants(connection, actorId, grants) : {},
})

export const connectionEndPayload = connectionId => ({ connectionId })

export function connectionCounterpart(connection, actorId) {
  if (connection?.studentId === actorId) return { id: connection.trainerId, role: 'trainer' }
  if (connection?.trainerId === actorId) return { id: connection.studentId, role: 'student' }
  return null
}

export function requestDirection(connection, actorId) {
  const participant = connectionCounterpart(connection, actorId)
  const outgoing = participant && connection.requestedBy === actorId
  const incoming = participant && connection.requestedBy === participant.id
  return {
    direction: outgoing ? 'outgoing' : incoming ? 'incoming' : 'unrelated',
    label: outgoing ? 'Sent by you' : incoming ? 'Waiting for your response' : 'Not available',
    canRespond: !!(incoming && connection.status === 'pending'),
  }
}

export function grantLabels(grants) {
  const normalized = normalizeExplicitGrants(grants)
  const labels = CONNECTION_GRANTS.filter(({ key }) => normalized[key]).map(({ label }) => label)
  return labels.length ? labels : ['No permissions granted']
}

export const roleLabel = role => role === 'trainer' ? 'Personal' : 'Student'

export function connectionStatusLabel(connection) {
  if (connection?.status === 'pending') return 'Pending'
  if (connection?.status === 'active') return 'Active'
  if (connection?.respondedAt && connection.respondedAt === connection.endedAt) return 'Refused'
  return 'Ended'
}
