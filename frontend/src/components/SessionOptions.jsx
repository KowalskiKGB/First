import { exCount } from '../lib/format.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from './Icon.jsx'

const SOURCE_LABEL = { manual: 'Manual', personal: 'Personal', ai: 'IA' }

export default function SessionOptions({ options = [], onSelect }) {
  return <div className="list">
    {options.map(option => <button
      type="button"
      className="item"
      key={`${option.sourceType}-${option.planId || 'local'}-${option.routineId}`}
      onClick={() => onSelect(option)}
      aria-label={`${option.routine.name}, ${SOURCE_LABEL[option.sourceType] || option.sourceType}`}
    >
      <span className="lrow-i"><Icon name={glyphOf(option.routine.emoji)} /></span>
      <span className="grow">
        <span className="tt" style={{ display: 'block' }}>{option.routine.name}</span>
        <span className="ss" style={{ display: 'block' }}>{option.label} · {exCount(option.routine.ex?.length || 0)}</span>
      </span>
      <span className={`tag${option.sourceType === 'ai' ? ' acc' : ''}`}>{SOURCE_LABEL[option.sourceType] || option.sourceType}</span>
      {option.preferred ? <span className="tag acc">Preferido</span> : null}
    </button>)}
  </div>
}
