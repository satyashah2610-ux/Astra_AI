import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LogIn, MailCheck, Sparkles } from 'lucide-react';
import { ApiError } from './api';
import { authApi } from './auth';

/** Opened from the emailed link `/confirm-email#<token>`. The account's password is asked for too, so someone who
 * signed up with another person's address can't get that person to confirm the account with one click. */
export default function ConfirmEmailPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);  // the link itself is unusable: no point asking again

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true); setError('');
    try {
      setDone((await authApi.confirm(token, password)).message);
      window.history.replaceState(null, '', '/confirm-email');  // drop the used link
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setInvalid(e instanceof ApiError && e.status === 400);
      setPassword('');
    } finally { setBusy(false); }
  }

  const brand = <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={18} strokeWidth={1.6} /></span>Astra Sign</span>;
  if (done || invalid) return <div className="auth-shell">
    <section className="auth-card" aria-labelledby="confirm-title">
      {brand}
      <h1 id="confirm-title">{done ? 'Email confirmed' : 'Link not valid'}</h1>
      {done ? <p className="auth-intro sent-note" role="status">{done}</p> : <div className="error-banner" role="alert">{error}</div>}
      <a className="primary auth-submit" href="/"><LogIn size={16} />Go to log in</a>
    </section>
  </div>;

  return <div className="auth-shell">
    <form className="auth-card" noValidate onSubmit={event => void submit(event)} aria-labelledby="confirm-title">
      {brand}
      <h1 id="confirm-title">Confirm your email</h1>
      <p className="auth-intro">Enter the password you chose when you created the account.</p>
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
