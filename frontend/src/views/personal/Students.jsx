import { useMemo, useState } from 'react'

import ClientForm from '../../components/personal/ClientForm.jsx'
import { Button, SearchField } from '../../components/ui.jsx'
import { t } from '../../lib/i18n.js'
import { filterAndSortClients } from '../../lib/personal-view.js'
import { useCollaboration } from '../../store/useCollaboration.js'
import { useUI } from '../../store/useUI.js'
import { ClientRow, EmptyPersonal, PersonalHeader, PersonalMutation } from './components.jsx'

const FILTERS = [
  ['all', 'All'],
  ['urgent', 'Urgent'],
  ['attention', 'Attention'],
  ['ok', 'Up to date'],
]

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

export default function Students() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const clients = useCollaboration(state => state.workspace?.clients || [])
  const loading = useCollaboration(state => state.loading)
  const filtered = useMemo(() => filterAndSortClients(clients, { query, status }), [clients, query, status])

  return (
    <main className="personal-page">
      <PersonalHeader
        title={t('Students')}
        subtitle={t('{0} active records, ordered by urgency', clients.length)}
        backTo="/personal"
        action={<Button variant="primary" icon="plus" onClick={openNewClient}>{t('New student')}</Button>}
      />
      <section className="student-tools" aria-label={t('Search and filter students')}>
        <SearchField
          value={query}
          onChange={event => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder={t('Search student, goal or priority…')}
          aria-label={t('Search students')}
        />
        <div className="filter-chips" role="group" aria-label={t('Filter by priority')}>
          {FILTERS.map(([value, label]) => (
            <button key={value} className={status === value ? 'on' : ''} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {t(label)}
            </button>
          ))}
        </div>
      </section>

      {loading && !clients.length ? <div className="empty" role="status">{t('Loading students…')}</div> : null}
      {!loading && clients.length ? (
        <section className="client-list" aria-label={t('Prioritized students')}>
          {filtered.map(client => <ClientRow key={client.id} client={client} />)}
          {!filtered.length ? <EmptyPersonal icon="magnifier" title={t('Nothing found')} body={t('Adjust the search or priority filter.')} /> : null}
        </section>
      ) : null}
      {!loading && !clients.length ? (
        <EmptyPersonal title={t('No students yet')} body={t('Create the first managed student to organize training, schedule and receivables.')} action={{ label: t('New student'), onClick: openNewClient }} />
      ) : null}
    </main>
  )
}
