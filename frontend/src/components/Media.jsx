import { useState } from 'react'
import { imgSrc, gifSrc, mediaEnabled } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { exerciseName, t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

const MEDIA_CREDIT = 'https://gymvisual.com/'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12).
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const [broken, setBroken] = useState(false)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!mediaEnabled || !ex.gif || broken) return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const fail = () => playing ? setPlaying(false) : setBroken(true)
  const togglePlayback = () => setPlaying(value => !value)
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id}>
      <button type="button" className="media-frame" aria-label={playing ? t('tap to pause') : t('tap to play')} onClick={togglePlayback}>
        <img decoding="async" src={playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseName(ex)} onError={fail} />
      </button>
      {!mini && <a className="media-credit" href={MEDIA_CREDIT} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>© Gym visual</a>}
      {minimizable && (
        <button type="button" className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && (
        <span className="gifhint" aria-hidden="true">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  const [broken, setBroken] = useState(false)
  if (!mediaEnabled || !ex.img || broken) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" src={imgSrc(ex)} alt="" onError={() => setBroken(true)} />
}
