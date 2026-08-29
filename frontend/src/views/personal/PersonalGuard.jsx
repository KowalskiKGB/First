import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

import { MOBILE } from '../../lib/mobile.js';
import { canEnterPersonal } from '../../lib/personal.js';
import { t } from '../../lib/i18n.js';
import { Button } from '../../components/ui.jsx';
import { useCollaboration } from '../../store/useCollaboration.js';
import { useStore } from '../../store/useStore.js';

export default function PersonalGuard({ children }) {
  const user = useStore(state => state.user);
  const isGuest = useStore(state => state.isGuest());
  const profile = useCollaboration(state => state.profile);
  const ownerId = useCollaboration(state => state.ownerId);
  const loading = useCollaboration(state => state.loading);
  const error = useCollaboration(state => state.error);
  const message = useCollaboration(state => state.message);
  const context = useCollaboration(state => state.context);
  const setContext = useCollaboration(state => state.setContext);
  const load = useCollaboration(state => state.load);
  const allowed = canEnterPersonal({ user, isGuest, mobile: MOBILE, profile, ownerId });
  const permissionRevoked = message === 'Permission revoked'
    || message === t('Permission revoked')
    || /revogada/i.test(String(message || ''));

  useEffect(() => {
    if (allowed && context !== 'trainer') setContext('trainer', user);
  }, [allowed, context, setContext, user]);

  if (allowed) return children;
  if (user?.id && !isGuest && !MOBILE && ownerId === user.id && permissionRevoked) {
    return <Navigate to="/home" replace />;
  }
  if (user?.id && !isGuest && !MOBILE && ownerId === user.id && error) {
    return (
      <div className="empty" role="alert">
        <p>{t('Could not load Personal')}</p>
        <Button variant="primary" onClick={() => load(user)}>{t('Try again')}</Button>
      </div>
    );
  }
  if (user?.id && !isGuest && !MOBILE && (!ownerId || (ownerId === user.id && loading))) {
    return <div className="empty" role="status">{t('Loading Personal…')}</div>;
  }
  return <Navigate to="/home" replace />;
}
