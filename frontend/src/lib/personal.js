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
  if (priority === 'ok') return 'Up to date';
  return reasons.length ? reasons.join(' · ') : priority === 'urgent' ? 'Needs action' : 'Watch';
};

export const priorityLabel = priority =>
  priority === 'urgent' ? 'Urgent' : priority === 'attention' ? 'Attention' : 'Up to date';

export const personalTabs = () => [
  { icon: 'chart', to: '/personal', label: 'Overview' },
  { icon: 'person', to: '/personal/alunos', label: 'Students' },
  { icon: 'calendar', to: '/personal/agenda', label: 'Schedule' },
  { icon: 'scale', to: '/personal/financeiro', label: 'Finances' },
  { icon: 'gear', to: '/settings', label: 'Adjustments' }
];

export const canEnterPersonal = ({ user, isGuest, profile, ownerId }) =>
  !!user?.id && !isGuest && ownerId === user.id && profile?.userId === user.id && profile.roles?.includes('trainer');

export const todayInputValue = () => new Date().toISOString().slice(0, 10);

export const timeInputValue = (hour = 9) => `${String(hour).padStart(2, '0')}:00`;

export function localDateTimeISO(date, time) {
  const [year, month, day] = String(date).split('-').map(Number);
  const [hour, minute] = String(time).split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute || 0).toISOString();
}
