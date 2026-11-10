import { useCallback, useEffect, useState } from 'react';
import { CloudOff, Loader2, RotateCcw } from 'lucide-react';
import App from './App';
import LoginPage from './LoginPage';
import { ApiError, LOGGED_OUT_EVENT } from './api';
import { authApi, type Account } from './auth';

type State = Account | 'checking' | 'logged-out' | 'unreachable';

/** The staff workspace, shown only to a logged-in user; everyone else gets the login page. */
export default function StaffGate() {
  const [state, setState] = useState<State>('checking');
  const [notice, setNotice] = useState('');  // shown on the login page, e.g. after deleting the account
  const loggedOut = useCallback(() => setState('logged-out'), []);

  const check = useCallback(() => {
    setState('checking');
    authApi.me().then(setState).catch(error => {
      // Only "not logged in" means log in; an outage must not look like a lost account.
      setState(error instanceof ApiError && error.status === 401 ? 'logged-out' : 'unreachable');
    });
  }, []);

  useEffect(() => {
    check();
    window.addEventListener(LOGGED_OUT_EVENT, loggedOut);  // a session that ends mid-use returns here
    return () => window.removeEventListener(LOGGED_OUT_EVENT, loggedOut);
  }, [check, loggedOut]);

  if (state === 'checking') return <div className="auth-shell"><p className="loading"><Loader2 className="spin" size={18} />Loading…</p></div>;
  if (state === 'unreachable') return <div className="auth-shell"><div className="auth-card outage" role="alert">
    <CloudOff size={28} />
    <h1>Can’t reach Astra Sign</h1>
    <p className="auth-intro">The server isn’t answering right now. Your agreements and files are safe. Check your connection and try again.</p>
    <button className="primary auth-submit" onClick={check}><RotateCcw size={16} />Retry</button>
  </div></div>;
  if (state === 'logged-out') return <LoginPage notice={notice} onSignedIn={account => { setNotice(''); setState(account); }} />;
  return <App account={state} onLogout={() => { void authApi.logout().catch(() => undefined).finally(loggedOut); }}
    onAccountDeleted={() => { setNotice('Your account has been deleted.'); loggedOut(); }} />;
}
