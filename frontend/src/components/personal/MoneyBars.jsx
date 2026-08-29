import { formatBRL } from '../../lib/personal-forms.js'

const monthName = period => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''))
  if (!match) return period || '—'
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
    .replace('.', '')
}
const cents = value => Number.isSafeInteger(value) && value >= 0 ? value : 0

export default function MoneyBars({ months = [] }) {
  const rows = months.slice(-6).map((month, index) => ({
    id: `${month.period || month.month || 'month'}-${index}`,
    period: month.period || month.month,
    expectedCents: cents(month.expectedCents),
    receivedCents: cents(month.receivedCents),
  }))
  const maximum = Math.max(1, ...rows.flatMap(row => [row.expectedCents, row.receivedCents]))
  const widthOf = value => `${Math.min(100, Math.max(0, value / maximum * 100))}%`

  return (
    <section className="money-bars" aria-labelledby="money-bars-title">
      <h2 id="money-bars-title">Recebimentos em seis meses</h2>

      {rows.length ? (
        <div className="money-bars-chart" aria-hidden="true">
          {rows.map(row => (
            <div className="money-bars-month" key={row.id}>
              <span className="money-bars-label">{monthName(row.period)}</span>
              <div className="money-bars-line expected">
                <span className="money-bars-fill" style={{ width: widthOf(row.expectedCents) }} />
                <span>{formatBRL(row.expectedCents)}</span>
              </div>
              <div className="money-bars-line received">
                <span className="money-bars-fill" style={{ width: widthOf(row.receivedCents) }} />
                <span>{formatBRL(row.receivedCents)}</span>
              </div>
            </div>
          ))}
          <p className="money-bars-legend"><span className="expected">Previsto</span><span className="received">Recebido</span></p>
        </div>
      ) : <p className="empty small">Nenhum dado financeiro nos últimos seis meses.</p>}

      <div className="table-scroll">
        <table className="money-bars-table">
          <caption>Histórico financeiro dos últimos seis meses</caption>
          <thead>
            <tr><th scope="col">Mês</th><th scope="col">Previsto</th><th scope="col">Recebido</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id}>
                <th scope="row">{monthName(row.period)}</th>
                <td>{formatBRL(row.expectedCents)}</td>
                <td>{formatBRL(row.receivedCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
