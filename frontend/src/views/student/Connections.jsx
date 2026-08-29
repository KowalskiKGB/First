import { useEffect, useRef, useState } from 'react'

import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { dateLocale, t } from '../../lib/i18n.js'
import {
  CONNECTION_GRANTS,
  CONNECTION_ENDPOINTS,
  connectionEndPayload,
  connectionCounterpart,
  connectionRequestPayload,
  connectionResponsePayload,
  connectionStatusLabel,
  grantLabels,
  normalizeExplicitGrants,
  requestDirection,
  roleLabel,
  sanitizeShareCode,
} from '../../lib/connections.js'
import { confirmSheet } from '../../sheets.jsx'
import { useCollaboration } from '../../store/useCollaboration.js'
import { useStore } from '../../store/useStore.js'

const EMPTY_GRANTS = normalizeExplicitGrants({})

function formattedDate(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : t('Date unavailable')
}

function GrantChecklist({ value, onChange, legend }) {
  const grants = normalizeExplicitGrants(value)
  return (
    <fieldset className="connections-grants">
      <legend>{legend}</legend>
      {CONNECTION_GRANTS.map(option => (
        <label className="connections-grant" key={option.key}>
          <input
            type="checkbox"
            checked={grants[option.key]}
            onChange={event => onChange({ ...grants, [option.key]: event.target.checked })}
          />
          <span className="connections-grant-copy">
            <strong>{t(option.label)}</strong>
            <small>{t(option.description)}</small>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

function PermissionSummary({ grants }) {
  return (
    <div className="connections-permissions">
      <h4>{t('Granted permissions')}</h4>
      <ul>{grantLabels(grants).map(label => <li key={label}>{t(label)}</li>)}</ul>
    </div>
  )
}

function Counterpart({ connection, actorId }) {
  const counterpart = connectionCounterpart(connection, actorId)
  if (!counterpart) return null
  return (
    <h3 className="connections-counterpart">
      <strong>{t(roleLabel(counterpart.role))}</strong>
      <code translate="no">{counterpart.id}</code>
    </h3>
  )
}

function ConnectionCard({ connection, actorId, actorRole, acceptance, setAcceptance, busy, respond, end }) {
  const request = requestDirection(connection, actorId)
  const trainerAskedStudent = actorId === connection.studentId && connection.requestedBy === connection.trainerId

  return (
    <article className={`connections-card connections-card-${connection.status}`}>
      <header className="connections-card-header">
        <Counterpart connection={connection} actorId={actorId} />
        <span className={`connections-status connections-status-${connection.status}`}>
          {t(connection.status === 'pending' ? request.label : connectionStatusLabel(connection))}
        </span>
      </header>
      <p className="connections-card-date">
        {t('Requested on {0}', formattedDate(connection.createdAt))}
      </p>
      <PermissionSummary grants={connection.grants} />

      {request.canRespond && trainerAskedStudent ? (
        <GrantChecklist
          value={acceptance}
          onChange={setAcceptance}
          legend={t('Choose exactly what this Personal may access')}
        />
      ) : null}

      {request.canRespond ? (
        <div className="connections-actions" role="group" aria-label={t('Respond to connection request')}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => respond(connection, true)}
          >
            {t('Accept')}
          </Button>
          <Button disabled={busy} onClick={() => respond(connection, false)}>{t('Refuse')}</Button>
        </div>
      ) : null}

      {connection.status === 'active' ? (
        <Button variant="danger" disabled={busy} onClick={() => end(connection)}>
          {t('End connection')}
        </Button>
      ) : null}
      {actorRole === 'trainer' && request.canRespond ? (
        <p className="connections-consent-note">{t('Accepting preserves the permissions explicitly chosen by the student. You cannot add permissions here.')}</p>
      ) : null}
    </article>
  )
}

export default function Connections() {
  const user = useStore(state => state.user)
  const ownerId = useCollaboration(state => state.ownerId)
  const context = useCollaboration(state => state.context)
  const profile = useCollaboration(state => state.profile)
  const connections = useCollaboration(state => state.connections)
  const notifications = useCollaboration(state => state.notifications)
  const loading = useCollaboration(state => state.loading)
  const loadError = useCollaboration(state => state.error)
  const storeMessage = useCollaboration(state => state.message)
  const load = useCollaboration(state => state.load)
  const mutate = useCollaboration(state => state.mutate)

  const [shareCode, setShareCode] = useState('')
  const [requestSelection, setRequestSelection] = useState(EMPTY_GRANTS)
  const [acceptance, setAcceptance] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const shareCodeRef = useRef(null)

  useEffect(() => {
    if (user?.id) load(user)
  }, [load, user?.id])

  const actorId = profile?.userId || ownerId
  const actorRole = context === 'trainer' && profile?.roles?.includes('trainer') ? 'trainer' : 'student'
  const pending = connections.filter(connection => connection.status === 'pending')
  const active = connections.filter(connection => connection.status === 'active')
  const history = connections.filter(connection => connection.status === 'ended')
  const unread = notifications.filter(notification => !notification.readAt).length

  const mutation = async (key, path, body, success) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await mutate(path, body)
      await load(user)
      setNotice(t(success))
      return true
    } catch (mutationError) {
      if (mutationError.status === 409) {
        setError(t('Data changed while you were acting. Your choices are still here; review them and repeat the action.'))
      } else if (mutationError.status === 403) {
        setError(t('Your permission was revoked. Privileged actions are now closed.'))
      } else {
        setError(mutationError.message || t('Could not update connections. Review the request and try again.'))
      }
      return false
    } finally {
      setBusy('')
    }
  }

  const requestConnection = async event => {
    event.preventDefault()
    if (shareCode.length !== 32) {
      setError(t('Enter the complete 32-character share code.'))
      shareCodeRef.current?.focus()
      return
    }
    const sent = await mutation(
      'request',
      CONNECTION_ENDPOINTS.request,
      connectionRequestPayload(actorRole, shareCode, requestSelection),
      'Connection request sent',
    )
    if (sent) {
      setShareCode('')
      setRequestSelection(EMPTY_GRANTS)
    }
  }

  const respond = async (connection, accept) => {
    const payload = connectionResponsePayload(
      connection,
      actorId,
      accept,
      acceptance[connection.id] || EMPTY_GRANTS,
    )
    const changed = await mutation(
      `respond-${connection.id}`,
      CONNECTION_ENDPOINTS.respond,
      payload,
      accept ? 'Connection accepted' : 'Connection refused',
    )
    if (changed) setAcceptance(current => Object.fromEntries(Object.entries(current).filter(([id]) => id !== connection.id)))
  }

  const end = connection => confirmSheet({
    title: t('End this connection?'),
    message: t('All shared permissions are revoked immediately. The connection remains in history.'),
    confirmText: t('End connection'),
    danger: true,
    onConfirm: () => mutation(
      `end-${connection.id}`,
      CONNECTION_ENDPOINTS.end,
      connectionEndPayload(connection.id),
      'Connection ended',
    ),
  })

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(profile.shareCode)
      setNotice(t('Share code copied'))
      setError('')
    } catch {
      setError(t('Could not copy the code. Select it and copy manually.'))
    }
  }

  const markRead = () => mutation('notifications', CONNECTION_ENDPOINTS.readNotifications, {}, 'Notifications marked as read')

  if (loading && !profile) return <div className="empty connections-loading" role="status">{t('Loading connections…')}</div>
  if (loadError && !profile) return (
    <main className="connections-page">
      <div className="empty connections-error" role="alert">
        <Icon name="shield" />
        <strong>{storeMessage || t('Could not load connections')}</strong>
        <p>{storeMessage ? t('Shared access is closed. Reload to confirm your current account permissions.') : loadError}</p>
        <Button variant="primary" onClick={() => load(user)}>{t('Try again')}</Button>
      </div>
    </main>
  )
  if (!profile) return null

  return (
    <main className="connections-page">
      <header className="connections-header">
        <span className="connections-eyebrow">{t(actorRole === 'trainer' ? 'Personal profile' : 'Student profile')}</span>
        <h1>{t('Connections')}</h1>
        <p>{t('Control who may collaborate with you and exactly what they may access.')}</p>
      </header>

      {storeMessage ? <p className="connections-notice" role="status">{storeMessage}</p> : null}
      {notice ? <p className="connections-notice" role="status">{notice}</p> : null}
      {error ? <p className="connections-alert" role="alert">{error}</p> : null}

      <section className="connections-share" aria-labelledby="connections-share-title">
        <div className="connections-section-heading">
          <div><h2 id="connections-share-title">{t('Your share code')}</h2><p>{t('Share this 128-bit code only with the person you want to connect.')}</p></div>
          <span className="connections-code-expiry">{t('Expires {0}', formattedDate(profile.shareCodeExpiresAt))}</span>
        </div>
        <div className="connections-code">
          <code aria-label={t('Your 32-character share code')} translate="no">{profile.shareCode}</code>
          <Button icon="clipboard" aria-label={t('Copy your share code')} onClick={copyCode}>{t('Copy code')}</Button>
        </div>
      </section>

      <section className="connections-request" aria-labelledby="connections-request-title">
        <div className="connections-section-heading">
          <div><h2 id="connections-request-title">{t('Request a connection')}</h2><p>{t('Enter the other person’s share code.')}</p></div>
        </div>
        <form onSubmit={requestConnection}>
          <label className="connections-code-field">
            <span>{t('32-character share code')}</span>
            <input
              ref={shareCodeRef}
              className="field"
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              maxLength={80}
              name="share-code"
              required
              spellCheck="false"
              type="text"
              value={shareCode}
              onChange={event => setShareCode(sanitizeShareCode(event.target.value))}
            />
          </label>
          {actorRole === 'student' ? (
            <GrantChecklist
              value={requestSelection}
              onChange={setRequestSelection}
              legend={t('Choose exactly what this Personal may access')}
            />
          ) : (
            <p className="connections-consent-note">{t('No permissions are requested now. The student chooses every permission when accepting.')}</p>
          )}
          <Button variant="primary" type="submit" disabled={busy === 'request'}>{t('Send request')}</Button>
        </form>
      </section>

      <section className="connections-inbox" aria-labelledby="connections-inbox-title">
        <div className="connections-section-heading"><h2 id="connections-inbox-title">{t('Pending requests')}</h2><span>{pending.length}</span></div>
        {pending.length ? pending.map(connection => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            actorId={actorId}
            actorRole={actorRole}
            acceptance={acceptance[connection.id] || EMPTY_GRANTS}
            setAcceptance={grants => setAcceptance(current => ({ ...current, [connection.id]: grants }))}
            busy={busy === `respond-${connection.id}`}
            respond={respond}
            end={end}
          />
        )) : <p className="connections-empty">{t('No pending requests.')}</p>}
      </section>

      <section className="connections-active" aria-labelledby="connections-active-title">
        <div className="connections-section-heading"><h2 id="connections-active-title">{t('Active connections')}</h2><span>{active.length}</span></div>
        {active.length ? active.map(connection => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            actorId={actorId}
            actorRole={actorRole}
            acceptance={EMPTY_GRANTS}
            setAcceptance={() => {}}
            busy={busy === `end-${connection.id}`}
            respond={respond}
            end={end}
          />
        )) : <p className="connections-empty">{t('No active connections.')}</p>}
      </section>

      <section className="connections-notifications" aria-labelledby="connections-notifications-title">
        <div className="connections-section-heading">
          <div><h2 id="connections-notifications-title">{t('Notifications')}</h2><p>{t('{0} unread', unread)}</p></div>
          {unread ? <Button disabled={busy === 'notifications'} onClick={markRead}>{t('Mark all as read')}</Button> : null}
        </div>
        {notifications.length ? (
          <ol className="connections-notification-list">
            {notifications.map(notification => (
              <li className={`connections-notification${notification.readAt ? ' is-read' : ' is-unread'}`} key={notification.id}>
                <Icon name={notification.readAt ? 'checkCircle' : 'bell'} />
                <span><strong>{notification.title || t('Notification')}</strong><span>{notification.body}</span><time dateTime={notification.createdAt}>{formattedDate(notification.createdAt)}</time></span>
                <em>{notification.readAt ? t('Read') : t('Unread')}</em>
              </li>
            ))}
          </ol>
        ) : <p className="connections-empty">{t('No notifications yet.')}</p>}
      </section>

      <section className="connections-history" aria-labelledby="connections-history-title">
        <div className="connections-section-heading"><h2 id="connections-history-title">{t('Connection history')}</h2><span>{history.length}</span></div>
        {history.length ? history.map(connection => (
          <ConnectionCard
            key={connection.id}
            connection={connection}
            actorId={actorId}
            actorRole={actorRole}
            acceptance={EMPTY_GRANTS}
            setAcceptance={() => {}}
            busy={false}
            respond={respond}
            end={end}
          />
        )) : <p className="connections-empty">{t('No ended connections.')}</p>}
      </section>
    </main>
  )
}
