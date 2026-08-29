import { Link } from 'react-router-dom';

import Icon from '../../components/Icon.jsx';
import { Button } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/format.js';
import { t } from '../../lib/i18n.js';
import { formatMoneyBRL, normalizePriority, priorityCopy, priorityLabel } from '../../lib/personal.js';

export function PersonalHeader({ title, subtitle, backTo, action }) {
  return (
    <div className="hdr">
      {backTo && <Link className="iconbtn" to={backTo} aria-label={t('Back')}><Icon name="chevronLeft" /></Link>}
      <div className="grow">
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value, icon = 'chart', tone }) {
  return (
    <div className="card">
      <div className="row dim small"><Icon name={icon} />{label}</div>
      <div className="stat-v" style={tone ? { color: `var(--${tone})`, marginTop: 8 } : { marginTop: 8 }}>{value}</div>
    </div>
  );
}

export function PriorityBadge({ client }) {
  const priority = normalizePriority(client);
  return <span className={'priority ' + priority}>{t(priorityLabel(priority))}</span>;
}

export function ClientRow({ client }) {
  const finance = client.finance || {};
  const name = client.name || t('Unnamed student');
  return (
    <Link className="item" to={'/personal/alunos/' + encodeURIComponent(client.id)}>
      <span className="grow">
        <span className="row between" style={{ gap: 8 }}>
          <span className="student-name">{name}</span>
          <PriorityBadge client={client} />
        </span>
        <span className="dim small" style={{ display: 'block', marginTop: 4 }}>{t(priorityCopy(client))}</span>
        <span className="dim small" style={{ display: 'block', marginTop: 4 }}>
          {t('{0}% adherence', client.progress?.adherence || 0)} · {client.nextAppointment ? fmtDate(client.nextAppointment.startsAt.slice(0, 10), true) : t('No class scheduled')} · {finance.overdueCents ? t('{0} overdue', formatMoneyBRL(finance.overdueCents)) : t('Finances up to date')}
        </span>
      </span>
      <Icon name="chevronRight" />
    </Link>
  );
}

export function EmptyPersonal({ icon = 'person', title, body, action }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} /></div>
      <div style={{ fontWeight: 600, color: 'var(--label)', marginBottom: 4 }}>{title}</div>
      <div>{body}</div>
      {action && <div style={{ marginTop: 14 }}><Button variant="primary" {...action}>{action.label}</Button></div>}
    </div>
  );
}
