import { useId } from 'react'

import { t } from '../../lib/i18n.js'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0

export default function TrendChart({ title, points = [], unit = '', valueFormatter }) {
  const titleId = useId()
  const rows = points.map((point, index) => ({
    id: point.id || `${point.label}-${index}`,
    label: point.label || point.observedAt || point.d || t('Entry {0}', index + 1),
    value: finite(point.value),
  }))
  const values = rows.map(row => row.value)
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 0
  const span = Math.max(1, maximum - minimum)
  const coordinates = rows.map((row, index) => ({
    x: rows.length === 1 ? 50 : 4 + index * (92 / (rows.length - 1)),
    y: 92 - ((row.value - minimum) / span) * 80,
  }))
  const formatValue = valueFormatter || (value => `${value.toLocaleString('pt-BR')} ${unit}`.trim())

  return (
    <section className="trend-card" aria-labelledby={titleId}>
      <div className="panel-heading">
        <h3 id={titleId}>{title}</h3>
        {rows.length ? <span className="data-value">{formatValue(rows.at(-1).value)}</span> : null}
      </div>
      {rows.length ? (
        <>
          <div className="trend-plot" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
              <line x1="4" y1="92" x2="96" y2="92" className="trend-axis" />
              <polyline points={coordinates.map(point => `${point.x},${point.y}`).join(' ')} className="trend-line" />
              {coordinates.map((point, index) => <circle key={rows[index].id} cx={point.x} cy={point.y} r="2.3" className="trend-point" />)}
            </svg>
          </div>
          <div className="table-scroll">
            <table className="trend-table">
              <caption>{t('{0} values in chronological order', title)}</caption>
              <thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('Value')}</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{formatValue(row.value)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : <p className="empty small">{t('Not enough data for this trend yet.')}</p>}
    </section>
  )
}
