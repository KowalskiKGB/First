export const formatMoneyBRL = cents => {
  const value = Math.abs(Math.round(Number(cents) || 0)) / 100;
  const formatted = value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s+/g, ' ');
  return Number(cents) < 0 ? '-' + formatted : formatted;
};

export const normalizePriority = client =>
  client?.priority === 'urgent' || client?.priority === 'attention' ? client.priority : 'ok';

export const priorityCopy = client => {
  const priority = normalizePriority(client);
  const reasons = (client?.reasons || []).filter(Boolean);
  if (priority === 'ok') return 'Em dia';
  return reasons.length ? reasons.join(' · ') : priority === 'urgent' ? 'Precisa de acao' : 'Acompanhar';
};

export const priorityLabel = priority =>
  priority === 'urgent' ? 'Urgente' : priority === 'attention' ? 'Atencao' : 'Em dia';

export const personalTabs = () => [
  { k: 'personal', icon: 'chart', to: '/personal', label: 'Painel' },
  { k: 'personal/alunos', icon: 'person', to: '/personal/alunos', label: 'Alunos' },
  { k: 'personal/agenda', icon: 'calendar', to: '/personal/agenda', label: 'Agenda' },
  { k: 'personal/financeiro', icon: 'scale', to: '/personal/financeiro', label: 'Financeiro' },
  { k: 'settings', icon: 'gear', to: '/settings', label: 'Ajustes' }
];

export const todayInputValue = () => new Date().toISOString().slice(0, 10);

export const timeInputValue = (hour = 9) => `${String(hour).padStart(2, '0')}:00`;

export function localDateTimeISO(date, time) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute || 0).toISOString();
}
