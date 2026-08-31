import ClientForm from '../../components/personal/ClientForm.jsx'
import { Button } from '../../components/ui.jsx'
import { t } from '../../lib/i18n.js'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import {
  AgendaRail,
  ClientRow,
  EmptyPersonal,
  MetricCard,
  PersonalHeader,
  PersonalMutation,
  formatMoneyBRL,
} from './components.jsx'

function NewClientSheet({ close }) {
  return (
    <>
      <h3>{t('New student')}</h3>
      <p className="sheet-intro">{t('Create a managed record now. You can connect a First account later.')}</p>
      <PersonalMutation path="/api/personal/clients" success="Student created" close={close}>
        {({ submit, busy }) => <ClientForm onSubmit={submit} busy={busy} />}
      </PersonalMutation>
    </>
  )
}

const openNewClient = () => useUI.getState().openSheet(close => <NewClientSheet close={close} />)

export default function PersonalHome() {
  const user = useStore(state => state.user)
  const workspace = useCollaboration(state => state.workspace)
  const loading = useCollaboration(state => state.loading)
  const error = useCollaboration(state => state.error)
  const message = useCollaboration(state => state.message)
  const load = useCollaboration(state => state.load)

  if (loading && !workspace) return <div className="empty" role="status">{t('Loading Personal…')}</div>
  if (error && !workspace) return (
    <EmptyPersonal icon="shield" title={t('Could not load Personal')} body={error}
      action={{ label: t('Try again'), onClick: () => load(user) }} />
  )

  const kpis = workspace?.kpis || {}
  const finance = workspace?.finance || {}
  const clients = workspace?.clients || []
  const urgent = clients.filter(client => client.priority === 'urgent')
  const urgentCount = kpis.priorities?.urgent || 0

  return (
    <main className="personal-page personal-dashboard workbook-page">
      <PersonalHeader
        title={t('Personal command center')}
        subtitle={t('Today’s students, time and cash flow in one operational view.')}
        action={<Button variant="primary" icon="plus" onClick={openNewClient}>{t('New student')}</Button>}
      />
      {message ? <p className="personal-notice" role="status">{message}</p> : null}

      <div className="personal-dashboard-grid">
        <section className="dashboard-main" aria-label={t('Operational and financial indicators')}>
          <div className="panel-heading"><h2>{t('Operation')}</h2><span>{t('Live workspace')}</span></div>
          <div className="metric-grid operational-metrics">
            <MetricCard label={t('Active students')} value={kpis.activeClients || 0} icon="person" />
            <MetricCard label={t('Classes today / 7 days')} value={`${kpis.appointmentsToday || 0} / ${kpis.appointments7d || 0}`} icon="calendar" />
            <MetricCard label={t('Free hours today')} value={t('{0} h', kpis.freeHoursToday || 0)} icon="clock" />
            <MetricCard label={t('Average adherence')} value={t('{0}%', kpis.averageAdherence || 0)} icon="chartLine" />
          </div>

          <div className="panel-heading section-heading"><h2>{t('This month')}</h2><span>{t('BRL')}</span></div>
          <div className="metric-grid financial-metrics">
            <MetricCard label={t('Expected')} value={formatMoneyBRL(finance.expectedCents || 0)} icon="scale" />
            <MetricCard label={t('Received')} value={formatMoneyBRL(finance.receivedCents || 0)} icon="checkCircle" tone="positive" />
            <MetricCard label={t('Outstanding')} value={formatMoneyBRL(finance.openCents || 0)} icon="clock" tone="warning" />
            <MetricCard label={t('Overdue')} value={formatMoneyBRL(finance.overdueCents || 0)} icon="bell" tone="danger" />
          </div>
        </section>

        <aside className="dashboard-priorities">
          <div className="panel-heading"><h2>{t('Priorities')}</h2><span>{urgentCount === 1 ? t('1 urgent') : t('{0} urgent', urgentCount)}</span></div>
          <div className="priority-summary" aria-label={t('Students by priority')}>
            <span><b>{kpis.priorities?.urgent || 0}</b>{t('Urgent')}</span>
            <span><b>{kpis.priorities?.attention || 0}</b>{t('Attention')}</span>
            <span><b>{kpis.priorities?.ok || 0}</b>{t('Up to date')}</span>
          </div>
          <div className="priority-list">
            {(urgent.length ? urgent : clients).slice(0, 5).map(client => <ClientRow key={client.id} client={client} compact />)}
            {!clients.length ? <EmptyPersonal title={t('No students yet')} body={t('Create a managed student to start planning the week.')} action={{ label: t('New student'), onClick: openNewClient }} /> : null}
          </div>
        </aside>

        <aside className="dashboard-agenda">
          <AgendaRail agenda={workspace?.agenda} />
        </aside>
      </div>
    </main>
  )
}
