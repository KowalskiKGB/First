import { useEffect, useState } from 'react'

import { centsToReais, fortalezaDateTime, fortalezaFields, reaisToCents, todayFortaleza } from '../../lib/personal-forms.js'
import { Button, TextArea, TextField } from '../ui.jsx'

const STATUSES = [
  ['open', 'Em aberto'],
  ['paid', 'Pago'],
  ['waived', 'Isento'],
]
const METHODS = [
  ['manual', 'Registro manual'],
  ['pix', 'PIX'],
  ['cash', 'Dinheiro'],
  ['transfer', 'Transferência'],
  ['card', 'Cartão'],
]

function initialDraft(receivable, clientId, fallbackClientId) {
  const today = todayFortaleza()
  return {
    clientId: receivable?.clientId || clientId || fallbackClientId,
    period: receivable?.period || today.slice(0, 7),
    dueOn: receivable?.dueOn || today,
    amount: receivable?.amountCents > 0 ? centsToReais(receivable.amountCents) : '',
    status: receivable?.status || 'open',
    paidOn: fortalezaFields(receivable?.paidAt).date || today,
    paymentMethod: receivable?.paymentMethod || 'manual',
    note: receivable?.note || '',
  }
}

export default function ReceivableForm({ receivable, clients = [], clientId = '', onSubmit, busy = false }) {
  const fallbackClientId = clients[0]?.id || ''
  const [draft, setDraft] = useState(() => initialDraft(receivable, clientId, fallbackClientId))
  const [error, setError] = useState('')

  useEffect(() => setDraft(initialDraft(receivable, clientId, fallbackClientId)), [receivable, clientId, fallbackClientId])

  let amountValid = false
  try {
    reaisToCents(draft.amount)
    amountValid = true
  } catch {
    amountValid = false
  }

  const submit = event => {
    event.preventDefault()
    try {
      const paid = draft.status === 'paid'
      const amountCents = reaisToCents(draft.amount)
      setError('')
      onSubmit?.({
        clientId: draft.clientId,
        ...(receivable?.id ? { id: receivable.id } : {}),
        period: draft.period,
        dueOn: draft.dueOn,
        amountCents,
        status: draft.status,
        paidAt: paid ? fortalezaDateTime(draft.paidOn, '12:00') : null,
        paymentMethod: paid ? draft.paymentMethod : null,
        note: draft.note.trim().slice(0, 240),
      })
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <form className="personal-form" onSubmit={submit} aria-label={receivable?.id ? 'Editar cobrança' : 'Criar cobrança'}>
      <div className="personal-form-grid">
        <label className="form-field">
          <span>Aluno</span>
          <select className="field" name="receivableClient" autoComplete="off" required value={draft.clientId} onChange={event => setDraft(current => ({ ...current, clientId: event.target.value }))} disabled={Boolean(clientId) && clients.length <= 1}>
            {!draft.clientId ? <option value="">Selecione um aluno</option> : null}
            {clients.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}
            {clientId && !clients.some(client => client.id === clientId) ? <option value={clientId}>Aluno selecionado</option> : null}
          </select>
        </label>

        <label className="form-field">
          <span>Competência</span>
          <input className="field" type="month" name="receivablePeriod" autoComplete="off" required value={draft.period} onChange={event => setDraft(current => ({ ...current, period: event.target.value }))} />
        </label>

        <label className="form-field">
          <span>Vencimento</span>
          <input className="field" type="date" name="receivableDueOn" autoComplete="off" required value={draft.dueOn} onChange={event => setDraft(current => ({ ...current, dueOn: event.target.value }))} />
        </label>

        <label className="form-field">
          <span>Valor em reais</span>
          <TextField name="receivableAmount" autoComplete="off" required inputMode="decimal" placeholder="Ex.: 150,00…" value={draft.amount} onChange={event => setDraft(current => ({ ...current, amount: event.target.value }))} aria-describedby="amount-cents-note" aria-invalid={draft.amount !== '' && !amountValid} />
          <small id="amount-cents-note" className={draft.amount !== '' && !amountValid ? 'form-error' : 'form-hint'}>
            {draft.amount === '' ? 'Informe um valor maior que R$ 0,00.' : amountValid ? 'Use vírgula para centavos. O valor é salvo em centavos inteiros.' : 'Valor inválido. Use um valor maior que R$ 0,00.'}
          </small>
        </label>

        <label className="form-field">
          <span>Status</span>
          <select className="field" name="receivableStatus" autoComplete="off" value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}>
            {STATUSES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </div>

      {draft.status === 'paid' ? (
        <fieldset className="personal-fieldset">
          <legend>Pagamento</legend>
          <div className="personal-form-grid">
            <label className="form-field">
              <span>Data do pagamento</span>
              <input className="field" type="date" name="paidOn" autoComplete="off" required max={todayFortaleza()} value={draft.paidOn} onChange={event => setDraft(current => ({ ...current, paidOn: event.target.value }))} />
            </label>
            <label className="form-field">
              <span>Método</span>
              <select className="field" name="paymentMethod" autoComplete="off" value={draft.paymentMethod} onChange={event => setDraft(current => ({ ...current, paymentMethod: event.target.value }))}>
                {METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      <label className="form-field">
        <span>Nota</span>
        <TextArea name="receivableNote" autoComplete="off" maxLength="240" rows="3" value={draft.note} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))} />
      </label>

      {error ? <p className="form-error" role="alert" aria-live="polite">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !draft.clientId || !amountValid}>
        {busy ? 'Salvando…' : 'Salvar cobrança'}
      </Button>
    </form>
  )
}
