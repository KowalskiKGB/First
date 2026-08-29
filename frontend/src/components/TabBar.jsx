import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useCollaboration } from '../store/useCollaboration.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { canEnterPersonal, personalTabs } from '../lib/personal.js'
import Icon from './Icon.jsx'

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const context = useCollaboration(s => s.context)
  const profile = useCollaboration(s => s.profile)
  const ownerId = useCollaboration(s => s.ownerId)
  if (!user && !isGuest) return null
  if (loc.pathname === '/dev') return null
  const trainerPortal = context === 'trainer' && canEnterPersonal({ user, isGuest, mobile: MOBILE, profile, ownerId })
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats') || (cur === 'settings' && k === 'home')

  const startWorkout = () => {
    if (S.active) { nav('/workout'); return }
    onStart()
  }
  const Tab = ({ k, icon, to, label, active = on(k) }) => (
    <button type="button" className={active ? 'on' : ''} aria-current={active ? 'page' : undefined} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  if (trainerPortal) return (
    <nav id="tabbar" aria-label={t('Trainer navigation')}>
      {personalTabs().map(tab => (
        <Tab key={tab.to} {...tab} label={t(tab.label)}
          active={tab.to === '/personal' ? loc.pathname === tab.to : loc.pathname.startsWith(tab.to)} />
      ))}
    </nav>
  )

  return (
    <nav id="tabbar" aria-label={t('Student navigation')}>
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <button type="button" className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Start')}</span>
      </button>
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <Tab k="library" icon="list" to="/library" label={t('Exercises')} />
    </nav>
  )
}
