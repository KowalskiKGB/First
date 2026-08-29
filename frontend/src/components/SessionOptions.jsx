import { exCount } from '../lib/format.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

const sourceLabel = source => source === 'manual' ? t('My workout') : source === 'personal' ? t('Personal') : source === 'ai' ? 'IA' : source

export default function SessionOptions({ options = [], onSelect }) {
  return <div className="list">
    {options.map(option => <button
      type="button"
      className="item"
      key={`${option.sourceType}-${option.planId || 'local'}-${option.routineId}`}
      onClick={() => onSelect(option)}
      aria-label={`${option.routine.name}, ${option.sourceType === 'manual' ? t(option.label) : sourceLabel(option.sourceType)}`}
    >
      <span className="lrow-i"><Icon name={glyphOf(option.routine.emoji)} /></span>
      <span className="grow">
        <span className="tt" style={{ display: 'block' }}>{option.routine.name}</span>
        <span className="ss" style={{ display: 'block' }}>{option.label} · {exCount(option.routine.ex?.length || 0)}</span>
      </span>
      <span className={`plan-source-badge source-${option.sourceType}`}>{sourceLabel(option.sourceType)}</span>
      {option.preferred ? <span className="tag acc">{t('Preferred')}</span> : null}
    </button>)}
  </div>
}
