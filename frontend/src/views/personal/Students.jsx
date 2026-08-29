import { useMemo, useState } from 'react';

import { useCollaboration } from '../../store/useCollaboration.js';
import { SearchField } from '../../components/ui.jsx';
import { searchKey } from '../../lib/exercises.js';
import { t } from '../../lib/i18n.js';
import { ClientRow, EmptyPersonal, PersonalHeader } from './components.jsx';

export default function Students() {
  const [q, setQ] = useState('');
  const clients = useCollaboration(s => s.workspace?.clients || []);
  const filtered = useMemo(() => {
    const needle = searchKey(q);
    return clients.filter(client => searchKey([client.name, client.goal, ...(client.reasons || [])].join(' ')).includes(needle));
  }, [clients, q]);

  return (
    <div className="narrow">
      <PersonalHeader title={t('Students')} subtitle={t('{0} in the list', filtered.length)} backTo="/personal" />
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search student, goal or priority…')} />
      <div style={{ height: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map(client => <ClientRow key={client.id} client={client} />)}
        {!filtered.length && <EmptyPersonal title={t('Nothing found')} body={t('Adjust the search or return to the overview.')} />}
      </div>
    </div>
  );
}
