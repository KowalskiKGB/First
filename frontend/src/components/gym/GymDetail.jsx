import { useState } from 'react'

import ExerciseCatalogPicker from '../ExerciseCatalogPicker.jsx'
import Icon from '../Icon.jsx'
import { gymMonogram } from '../../lib/gym-directory.js'
import { t } from '../../lib/i18n.js'
import GymContributionForm from './GymContributionForm.jsx'
import StarRating from './StarRating.jsx'

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function OpeningHours({ gym }) {
  if (!gym.openingHours?.length && !gym.openingHoursNote) return <p className="muted small">{t('Hours not informed')}</p>
  return <>
    {gym.openingHoursNote ? <p className="muted small">{gym.openingHoursNote}</p> : null}
    {gym.openingHours?.length ? <dl className="gym-opening-hours">{gym.openingHours.map((entry, index) => <div key={`${entry.day}-${index}`}>
      <dt>{t(DAY_LABELS[entry.day] || 'Day')}</dt><dd>{entry.closed ? t('Closed') : `${entry.open} – ${entry.close}`}</dd>
    </div>)}</dl> : null}
  </>
}

function Reviews({ reviews = [] }) {
  return <section className="gym-reviews" aria-labelledby="gym-reviews-title">
    <h2 id="gym-reviews-title">{t('Community reviews')}</h2>
    {reviews.length ? <div className="gym-review-list">{reviews.map(review => <article key={review.id}>
      <header><strong>{review.displayName || t('Student')}</strong><span><Icon name="starFill" /> {review.rating}</span>{review.demo ? <em>{t('Demonstration')}</em> : null}</header>
      {review.comment ? <p>{review.comment}</p> : null}
    </article>)}</div> : <p className="muted small">{t('No community reviews yet.')}</p>}
  </section>
}

export default function GymDetail({
  gym, reviews = [], selected = false, authenticated = false, busy = false,
  onBack, onSelect, onToggleFavorite, onSubmitReview, onSubmitContribution, onRequireLogin,
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [contribution, setContribution] = useState('')
  const favorite = gym.tags?.includes('Preferida') || gym.favorite === true
  const requireLogin = action => {
    if (authenticated) action()
    else onRequireLogin()
  }
  const chooseContribution = kind => requireLogin(() => setContribution(kind))
  const submitReview = event => {
    event.preventDefault()
    requireLogin(() => onSubmitReview({ rating, comment: comment.trim() }))
  }
  const routeQuery = encodeURIComponent(`${gym.name}, ${gym.address}, ${gym.city}, ${gym.state}`)

  return <section className="gym-detail" aria-labelledby="gym-detail-title">
    <nav className="gym-detail-nav" aria-label={t('Gym detail actions')}>
      <button type="button" className="iconbtn" onClick={onBack} aria-label={t('Back to gyms')}><Icon name="chevronLeft" /></button>
      <button type="button" className={`gym-favorite${favorite ? ' is-favorite' : ''}`} aria-pressed={favorite} onClick={() => requireLogin(onToggleFavorite)}>
        <Icon name="heart" />{favorite ? t('Favorited') : t('Favorite')}
      </button>
    </nav>
    <header className="gym-detail-heading">
      <span className="gym-monogram" aria-hidden="true">{gymMonogram(gym.name)}</span>
      <div><span className="personal-eyebrow" translate={gym.networkName ? 'no' : undefined}>{gym.networkName || t('Independent gym')}</span><h1 id="gym-detail-title" tabIndex="-1" translate="no">{gym.name}</h1><p>{[gym.neighborhood, gym.address, `${gym.city} / ${gym.state}`].filter(Boolean).join(' · ')}</p></div>
    </header>
    <div className="gym-detail-signal">
      {gym.averageRating != null ? <span><Icon name="starFill" /><strong>{Number(gym.averageRating).toLocaleString('pt-BR')}</strong><small>{t('{0} reviews', gym.reviewCount || 0)}</small></span> : <span>{t('No ratings yet')}</span>}
      {gym.tags?.map(tag => <em key={tag}>{tag}</em>)}
    </div>
    <div className="gym-detail-actions">
      <a className="btn" href={`https://www.openstreetmap.org/search?query=${routeQuery}`} target="_blank" rel="noreferrer"><Icon name="globe" />{t('Open route')}</a>
      <button type="button" className="btn primary" onClick={() => onSelect(gym)}><Icon name="check" />{selected ? t('Selected gym') : t('Select this gym')}</button>
    </div>
    <section className="gym-hours-block"><h2>{t('Opening hours')}</h2><OpeningHours gym={gym} /></section>
    <section className="gym-inventory"><h2>{t('Available exercises')}</h2><ExerciseCatalogPicker selectedIds={gym.exerciseIds || []} readOnly searchName="gym-exercise-search" /></section>
    <form className="gym-review-form" onSubmit={submitReview}>
      <header><h2>{t('Rate this gym')}</h2><p>{t('One active review per account. You can update it anytime.')}</p></header>
      <StarRating value={rating} onChange={value => requireLogin(() => setRating(value))} disabled={busy} />
      <label><span>{t('Comment (optional)')}</span><textarea name="gym-review-comment" value={comment} onChange={event => setComment(event.target.value)} maxLength={600} autoComplete="off" /></label>
      <button type="submit" className="btn primary" disabled={busy}>{busy ? t('Sending…') : t('Publish review')}</button>
    </form>
    <Reviews reviews={reviews} />
    <section className="gym-community-actions" aria-labelledby="gym-contribute-title">
      <header><h2 id="gym-contribute-title">{t('Help keep this gym updated')}</h2><p>{t('Every structural change is checked before it appears publicly.')}</p></header>
      <div><button type="button" className="btn" onClick={() => chooseContribution('correction')}>{t('Suggest a correction')}</button><button type="button" className="btn" onClick={() => chooseContribution('equipment')}>{t('Add equipment')}</button><button type="button" className="btn" onClick={() => chooseContribution('closure')}>{t('Report closure')}</button></div>
      {contribution ? <GymContributionForm kind={contribution} gym={gym} busy={busy} onCancel={() => setContribution('')} onSubmit={payload => Promise.resolve(onSubmitContribution(contribution, payload)).then(sent => { if (sent !== false) setContribution('') })} /> : null}
    </section>
  </section>
}
