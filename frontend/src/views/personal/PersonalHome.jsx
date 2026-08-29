import { useStore } from '../../store/useStore.js';
import { useCollaboration } from '../../store/useCollaboration.js';
import { t } from '../../lib/i18n.js';
import { formatMoneyBRL } from '../../lib/personal.js';
import { ClientRow, EmptyPersonal, MetricCard, PersonalHeader } from './components.jsx';

export default function PersonalHome() {
  const user = useStore(state => state.user);
  const workspace = useCollaboration(state => state.workspace);
  const loading = useCollaboration(state => state.loading);
  const error = useCollaboration(state => state.error);
  const message = useCollaboration(state => state.message);
  const load = useCollaboration(state => state.load);

  if (loading && !workspace) return <div className="empty" role="status">{t('Loading Personal…')}</div>;
  if (error && !workspace) return (
    <EmptyPersonal icon="shield" title={t('Could not load Personal')} body={error}
      action={{ label: t('Try again'), onClick: () => load(user) }} />
  );

  const kpis = workspace?.kpis || {};
  const finance = workspace?.finance || {};
  const clients = workspace?.clients || [];

  return (
    <div className="narrow">
      <PersonalHeader title={t('Personal')} subtitle={t('{0} active students', kpis.activeClients || 0)} />
      {message && <p className="sect-f" role="status">{message}</p>}
      <div className="grid2">
        <MetricCard label={t('Students')} value={kpis.activeClients || 0} icon="person" />
        <MetricCard label={t('Classes today')} value={kpis.appointmentsToday || 0} icon="calendar" />
        <MetricCard label={t('Free hours')} value={kpis.freeHoursToday || 0} icon="clock" />
        <MetricCard label={t('Average adherence')} value={(kpis.averageAdherence || 0) + '%'} icon="chart" />
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <MetricCard label={t('Expected this month')} value={formatMoneyBRL(finance.expectedCents || 0)} icon="scale" />
        <MetricCard label={t('Received')} value={formatMoneyBRL(finance.receivedCents || 0)} icon="checkCircle" tone="green" />
        <MetricCard label={t('Outstanding')} value={formatMoneyBRL(finance.openCents || 0)} icon="clock" tone="orange" />
        <MetricCard label={t('Overdue')} value={formatMoneyBRL(finance.overdueCents || 0)} icon="bell" tone="red" />
      </div>
      <h2 className="sec">{t('Priorities')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {clients.slice(0, 8).map(client => <ClientRow key={client.id} client={client} />)}
        {!clients.length && <EmptyPersonal title={t('No students yet')} body={t('Students will appear here after they are added or connected.')} />}
      </div>
    </div>
  );
}
