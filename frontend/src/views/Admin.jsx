import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { accessDate, accountPresence, relativeAccess } from '../lib/admin-presence.js'
import { fmtDate, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
const dur = ms => {
  if (!Number.isFinite(ms)) return 'agora'
  const minutes = Math.max(0, Math.floor(ms / 60000))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h${minutes % 60}min`
}

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">Carregando…</div>
  const u = {
    ...d.user,
    online: d.user?.online ?? d.online ?? false,
    lastAccessAt: d.user?.lastAccessAt ?? d.lastAccessAt ?? null,
    lastLoginAt: d.user?.lastLoginAt ?? d.lastLoginAt ?? null,
  }
  const now = Number.isFinite(d.now) ? d.now : Date.now()
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'Conta desativada' : 'Conta reativada'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="muted small" style={{ marginTop: -8 }}>{u.email || 'E-mail não informado'}</div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">Administrador</span>}
      <span className={`tag nocap${u.online && !u.disabled ? ' acc' : ''}`} style={u.disabled ? { color: 'var(--red)' } : undefined}>{accountPresence(u, now)}</span>
      {u.invitedBy && <span className="tag nocap">Convite {u.invitedBy}</span>}
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Último acesso</div><div className="v" style={{ fontSize: '.9rem', lineHeight: 1.3 }}>{accessDate(u.lastAccessAt)}<div className="dim" style={{ fontSize: '.72rem', marginTop: 3 }}>{relativeAccess(u.lastAccessAt, now) ? `há ${relativeAccess(u.lastAccessAt, now)}` : 'sem atividade registrada'}</div></div></div>
      <div className="tile"><div className="l">Último login</div><div className="v" style={{ fontSize: '.9rem', lineHeight: 1.3 }}>{accessDate(u.lastLoginAt)}<div className="dim" style={{ fontSize: '.72rem', marginTop: 3 }}>{relativeAccess(u.lastLoginAt, now) ? `há ${relativeAccess(u.lastLoginAt, now)}` : 'sem login registrado'}</div></div></div>
      <div className="tile"><div className="l">Cadastro</div><div className="v" style={{ fontSize: '.95rem' }}>{u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</div></div>
      <div className="tile"><div className="l">Última sincronização</div><div className="v" style={{ fontSize: '.95rem' }}>{relativeAccess(d.lastSync, now) ? `há ${relativeAccess(d.lastSync, now)}` : '—'}</div></div>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Treinos</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Pesagens</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Rotinas</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: `Desativar ${u.name}?`, message: 'A pessoa será desconectada e não poderá sincronizar ou entrar até a conta ser reativada.', confirmText: 'Desativar', danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? 'Reativar conta' : 'Desativar conta'}</button>}
    <h4 className="sec">Histórico de treinos</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} séries{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">Nenhum treino registrado.</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(`Código ${invite.code} criado e copiado`); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast('Código revogado'); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Códigos de convite</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Gerar</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} disponíveis · {used.length} resgatados</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <button type="button" style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em', padding: '7px 2px' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(`Código ${i.code} copiado`) }} aria-label={`Copiar código ${i.code}`}>{i.code}</button>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="Revogar código"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || 'usado'}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">Nenhum código. Gere um para convidar alguém.</div>}
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [serverNow, setServerNow] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => {
    setUsers(d.users)
    setInviteOnly(d.invite_only)
    setServerNow(Number.isFinite(d.now) ? d.now : null)
  }).catch(e => toast(e.message || 'Não foi possível carregar as contas'))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  // Polling keeps presence and active workouts current without requiring a manual refresh.
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const onlineCount = (users || []).filter(u => u.online && !u.disabled).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? `${users.length} cadastrados · ${onlineCount} online${inviteOnly ? ' · acesso por convite' : ''}` : 'Carregando…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label="Atualizar">↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Cadastrados</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">Online</div><div className="v" style={{ color: onlineCount ? 'var(--acc)' : undefined }}>{users ? onlineCount : '—'}</div></div>
      <div className="tile"><div className="l">Treinando agora</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">Desativados</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card">
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Treinando agora</h2>
      {liveUsers.map(u => <button type="button" key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', width: '100%', textAlign: 'left' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name || 'Treino'} · exercício {u.live.exIdx ?? '—'}/{u.live.exTotal ?? '—'} · {u.live.setsDone ?? '—'}/{u.live.setsTotal ?? '—'} séries</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </button>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">Contas cadastradas</h4>
    <div className="list">
      {(users || []).map(u => <button type="button" key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : undefined}>
        <div className="grow">
          <div className="tt">{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>admin</span>}{u.disabled && <span className="tag nocap" style={{ marginLeft: 4, color: 'var(--red)' }}>desativada</span>}</div>
          <div className="ss" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email || 'E-mail não informado'}</div>
          <div className="ss row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: u.online && !u.disabled ? 'var(--acc)' : undefined }}>{accountPresence(u, serverNow ?? Date.now())}</span>
            <span aria-hidden="true">·</span>
            <span>{u.workouts || 0} treinos{u.lastWorkout ? ` · último em ${fmtDate(u.lastWorkout)}` : ''}</span>
            {u.live && <span className="tag acc nocap">Treinando · {u.live.name || 'Treino'}</span>}
          </div>
        </div>
        {u.hasPush && <Icon name="bell" title="Notificações ativadas" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </button>)}
      {users && !users.length && <div className="empty">Nenhuma conta cadastrada.</div>}
    </div>
  </div>
}
