import { Link } from 'react-router-dom'

import MoneyBars from '../../components/personal/MoneyBars.jsx'
import ReceivableForm from '../../components/personal/ReceivableForm.jsx'
import { Button } from '../../components/ui.jsx'
import { t } from '../../lib/i18n.js'
import { clientFinanceStatus, receivableStatusLabel } from '../../lib/personal-view.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import { useUI } from '../../store/useUI.js'
import {
  EmptyPersonal,
  MetricCard,
  PersonalHeader,
  PersonalMutation,
  StatusBadge,
  formatMoneyBRL,
} from './components.jsx'

function ReceivableSheet({ close, clients, receivable }) {
  const editing = Boolean(receivable?.id)
  return (
    <>
      <h3>{t(editing ? 'Edit charge' : 'New charge')}</h3>
      <p className="sheet-intro">{t('Manual accounts receivable in BRL. No payment is processed here.')}</p>
      <PersonalMutation
        path={editing ? '/api/personal/receivable' : '/api/personal/receivables'}
        method={editing ? 'PUT' : 'POST'}
        success={editing ? 'Charge updated' : 'Charge created'}
        close={close}
      >
        {({ submit, busy }) => <ReceivableForm receivable={receivable} clients={clients} onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

const openReceivable = (clients, receivable = null) => useUI.getState().openSheet(close => (
  <ReceivableSheet close={close} clients={clients} receivable={receivable} />
))

export default function Finance() {
  const workspace = useCollaboration(state => state.workspace)
  const loading = useCollaboration(state => state.loading)
  const error = useCollaboration(state => state.error)
  const message = useCollaboration(state => state.message)

  if (loading && !workspace) return <div className="empty" role="status">{t('Loading finances…')}</div>
  if (!workspace) return <EmptyPersonal icon="shield" title={t('Finances unavailable')} body={message || error || t('Your professional access may have changed.')} />

  const finance = workspace.finance || {}
  const clients = workspace.clients || []

  return (
    <main className="personal-page">
      <PersonalHeader
        title={t('Accounts receivable')}
        subtitle={t('Manual monthly control in BRL, separated from payment processing.')}
        backTo="/personal"
        action={<Button variant="primary" icon="plus" onClick={() => openReceivable(clients)} disabled={!clients.length}>{t('New charge')}</Button>}
      />
      {message ? <p className="personal-notice" role="status">{message}</p> : null}

      <section className="metric-grid finance-kpis" aria-label={t('Financial indicators')}>
        <MetricCard label={t('Expected this month')} value={formatMoneyBRL(finance.expectedCents || 0)} icon="scale" />
        <MetricCard label={t('Received')} value={formatMoneyBRL(finance.receivedCents || 0)} icon="checkCircle" tone="positive" />
        <MetricCard label={t('Outstanding')} value={formatMoneyBRL(finance.openCents || 0)} icon="clock" tone="warning" />
        <MetricCard label={t('Overdue')} value={formatMoneyBRL(finance.overdueCents || 0)} icon="bell" tone="danger" />
      </section>

      <div className="finance-layout">
        <MoneyBars months={finance.months || []} />

        <section className="personal-panel" aria-labelledby="finance-clients-title">
          <div className="panel-heading"><h2 id="finance-clients-title">{t('By student')}</h2><span>{t('{0} students', clients.length)}</span></div>
          {clients.length ? (
            <div className="finance-client-list">
              {clients.map(client => {
                const status = clientFinanceStatus(client.finance)
                const label = status === 'none' ? t('No charges') : t(receivableStatusLabel(status))
                return (
                  <article className="finance-client-row" key={client.id}>
                    <div>
                      <strong>{client.name}</strong>
                      <span>{t('Expected {0} · received {1}', formatMoneyBRL(client.finance?.expectedCents || 0), formatMoneyBRL(client.finance?.receivedCents || 0))}</span>
                    </div>
                    <StatusBadge status={status}>{label}</StatusBadge>
                    <div className="row-actions">
                      <Button onClick={() => openReceivable([{ id: client.id, name: client.name }])}>{t('Charge')}</Button>
                      <Link className="btn plain" to={`/personal/alunos/${encodeURIComponent(client.id)}/financeiro`}><span>{t('Details')}</span></Link>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : <EmptyPersonal title={t('No students yet')} body={t('Create a student before adding a charge.')} />}
        </section>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </main>
  )
}
