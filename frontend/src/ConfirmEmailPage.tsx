import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, MailCheck, Sparkles } from 'lucide-react';
import { ApiError } from './api';
import { authApi } from './auth';

export const LINK_USED = 'This confirmation link has already been used or has expired. Log in to continue.';

/** Opened from the emailed link `/confirm-email#<token>`. The account's password is asked for once (so someone who
 * signed up with another person's address can't get that person into their account with one click); confirming then
 * logs straight in. A used or expired link goes to the login page without asking anything. */
export default function ConfirmEmailPage({ token, onFinished }: { token: string; onFinished: (notice?: string) => void }) {
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    authApi.confirmCheck(token).then(valid => {
      if (!live) return;
      if (valid) setChecking(false);
      else onFinished(LINK_USED);
    }).catch(() => { if (live) setChecking(false); });  // can't tell: show the form; confirming will say
    return () => { live = false; };
  }, [token, onFinished]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try {
      await authApi.confirm(token, password);
      onFinished();  // logged in: the app opens
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) { onFinished(LINK_USED); return; }
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setPassword('');
      setBusy(false);
    }
  }

  const brand = <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={18} strokeWidth={1.6} /></span>Astra Sign</span>;
  if (checking) return <div className="auth-shell"><p className="loading"><Loader2 className="spin" size={18} />Loading…</p></div>;

  return <div className="auth-shell">
    <form className="auth-card" noValidate onSubmit={event => void submit(event)} aria-labelledby="confirm-title">
      {brand}
      <h1 id="confirm-title">Confirm your email</h1>
      <p className="auth-intro">Enter the password you chose when you created the account. You’ll go straight to your workspace.</p>
      <div className="form-field">
        <label htmlFor="confirm-password">Password</label>
        <div className="password-row">
          <input id="confirm-password" type={show ? 'text' : 'password'} value={password} autoComplete="current-password" maxLength={200} disabled={busy}
            onChange={e => setPassword(e.target.value)} />
          <button type="button" className="icon-button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
      </div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <button type="submit" className="primary auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <MailCheck size={16} />}Confirm email</button>
    </form>
  </div>;
}
