import Icon from '../Icon.jsx'
import { gymMonogram, isGymOpen } from '../../lib/gym-directory.js'
import { t } from '../../lib/i18n.js'

const formatDistance = value => Number.isFinite(Number(value))
  ? Number(value) < 1 ? `${Math.round(Number(value) * 1000)} m` : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
  : ''

export default function GymCard({ gym, active = false, onOpen }) {
  const open = isGymOpen(gym)
  const status = open == null ? t('Hours not informed') : open ? t('Open now') : t('Closed now')
  return <button type="button" className={`card gym-result${active ? ' is-open' : ''}`} data-gym-id={gym.id} onClick={onOpen}>
    <span className="gym-monogram" aria-hidden="true">{gymMonogram(gym.name)}</span>
    <span className="gym-result-copy">
      <span className="gym-card-title"><strong translate="no">{gym.name}</strong>{gym.networkName ? <small translate="no">{gym.networkName}</small> : null}</span>
      <span>{[gym.neighborhood, gym.address].filter(Boolean).join(' · ')}</span>
      <span className="gym-card-signal">
        {gym.distanceKm != null ? <b>{formatDistance(gym.distanceKm)}</b> : null}
        <i className={open ? 'is-open' : ''}>{status}</i>
        {gym.averageRating != null ? <><Icon name="starFill" /><b>{Number(gym.averageRating).toLocaleString('pt-BR')}</b><small>({gym.reviewCount || 0})</small></> : <small>{t('No ratings yet')}</small>}
      </span>
      {gym.tags?.length ? <span className="gym-card-tags">{gym.tags.slice(0, 3).map(tag => <em key={tag}>{tag}</em>)}</span> : null}
    </span>
    <Icon name="chevronRight" />
  </button>
}
