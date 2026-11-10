import { useCallback, useEffect, useState } from 'react';
import { CloudOff, Loader2, RotateCcw } from 'lucide-react';
import App from './App';
import LoginPage from './LoginPage';
import { ApiError, LOGGED_OUT_EVENT } from './api';
import { authApi, type Account } from './auth';
import { IDLE_NOTICE, useIdleLogout } from './idle';

type State = Account | 'checking' | 'logged-out' | 'unreachable';

/** The staff workspace, shown only to a logged-in user; everyone else gets the login page. */
export default function StaffGate({ notice: initialNotice = '' }: { notice?: string }) {
  const [state, setState] = useState<State>('checking');
  const [notice, setNotice] = useState(initialNotice);  // shown on the login page, e.g. after deleting the account
  const loggedOut = useCallback(() => setState('logged-out'), []);
  const sessionEnded = useCallback(() => { setNotice('Your session has ended. Log in again to continue.'); setState('logged-out'); }, []);

  const check = useCallback(() => {
    setState('checking');
    authApi.me().then(setState).catch(error => {
      // Only "not logged in" means log in; an outage must not look like a lost account.
      setState(error instanceof ApiError && error.status === 401 ? 'logged-out' : 'unreachable');
    });
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(LOGGED_OUT_EVENT, sessionEnded);  // a session the server ended mid-use returns here
    return () => window.removeEventListener(LOGGED_OUT_EVENT, sessionEnded);
  }, [check, sessionEnded]);

  if (state === 'checking') return <div className="auth-shell"><p className="loading"><Loader2 className="spin" size={18} />Loading…</p></div>;
  if (state === 'unreachable') return <div className="auth-shell"><div className="auth-card outage" role="alert">
    <CloudOff size={28} />
    <h1>Can’t reach Astra Sign</h1>
    <p className="auth-intro">The server isn’t answering right now. Your agreements and files are safe. Check your connection and try again.</p>
    <button className="primary auth-submit" onClick={check}><RotateCcw size={16} />Retry</button>
  </div></div>;
  if (state === 'logged-out') return <LoginPage notice={notice} onSignedIn={account => { setNotice(''); setState(account); }} />;
  return <SignedIn account={state} onLogout={notice => { setNotice(notice ?? ''); void authApi.logout().catch(() => undefined).finally(loggedOut); }}
    onAccountDeleted={() => { setNotice('Your account has been deleted.'); loggedOut(); }} />;
}

/** The workspace, logged out after 10 minutes without activity (the server ends the session then, too). */
function SignedIn({ account, onLogout, onAccountDeleted }: { account: Account; onLogout: (notice?: string) => void; onAccountDeleted: () => void }) {
  const onIdle = useCallback(() => onLogout(IDLE_NOTICE), [onLogout]);
  const keepAlive = useCallback(() => authApi.me().catch(error => {
    if (error instanceof ApiError && error.status === 401) onIdle();  // the server already ended it
  }), [onIdle]);
  useIdleLogout(onIdle, keepAlive);
  return <App account={account} onLogout={() => onLogout()} onAccountDeleted={onAccountDeleted} />;
}
