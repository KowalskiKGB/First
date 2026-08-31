import Icon from '../Icon.jsx'
import { t } from '../../lib/i18n.js'

export default function StarRating({ value = 0, onChange = () => {}, disabled = false }) {
  return <fieldset className="gym-star-fieldset">
    <legend>{t('Your rating')}</legend>
    <div className="gym-stars" role="radiogroup" aria-label={t('Your rating')}>
      {[1, 2, 3, 4, 5].map(rating => <label key={rating}>
        <input type="radio" name="gym-rating" value={rating} checked={value === rating} disabled={disabled} required onChange={() => onChange(rating)} />
        <span className="gym-star-icon" aria-hidden="true"><Icon name={value >= rating ? 'starFill' : 'star'} /></span>
        <span className="sr-only">{t('{0} stars', rating)}</span>
      </label>)}
    </div>
  </fieldset>
}
