import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, LogIn, Sparkles } from 'lucide-react';
import { authApi } from './auth';

/** Opened from the emailed link `/reset-password#<token>`: choose a new password, then log in with it. */
export default function ResetPasswordPage({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [problem, setProblem] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = { ...(password.length < 10 ? { password: 'Use at least 10 characters.' } : {}),
                    ...(password.length >= 10 && password !== confirm ? { confirm: 'The passwords don’t match.' } : {}) };
    setProblem(found); setError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setDone((await authApi.reset(token, password)).message);
      window.history.replaceState(null, '', '/reset-password');  // drop the used link: not kept in history, and a reload goes to log in
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }

  const input = (id: string, label: string, value: string, set: (v: string) => void, message?: string) => <div className={`form-field ${message ? 'invalid' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <div className="password-row">
      <input id={id} type={show ? 'text' : 'password'} value={value} autoComplete="new-password" maxLength={200} disabled={busy}
        aria-invalid={Boolean(message)} aria-describedby={message ? `${id}-error` : undefined} onChange={e => set(e.target.value)} />
      {id === 'new-password' && <button type="button" className="icon-button" aria-label={show ? 'Hide passwords' : 'Show passwords'} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
    </div>
    {message && <small className="field-error" id={`${id}-error`}>{message}</small>}
  </div>;

  const brand = <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={20} strokeWidth={1.6} /></span>Astra Sign</span>;
  if (done) return <div className="auth-shell">
    <section className="auth-card" aria-labelledby="reset-title">
      {brand}
      <h1 id="reset-title">Password reset</h1>
      <p className="auth-intro sent-note" role="status">{done}</p>
      <a className="primary auth-submit" href="/"><LogIn size={16} />Go to log in</a>
    </section>
  </div>;

  return <div className="auth-shell">
    <form className="auth-card" noValidate onSubmit={event => void submit(event)} aria-labelledby="reset-title">
      {brand}
      <h1 id="reset-title">Choose a new password</h1>
      <p className="auth-intro">After saving, you’ll be signed out on every device. Then log in with your new password.</p>
      {input('new-password', 'New password', password, setPassword, problem.password)}
      {input('confirm-password', 'Confirm new password', confirm, setConfirm, problem.confirm)}
      {!problem.password && <small className="field-hint">At least 10 characters. A short phrase is easiest to remember.</small>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><a className="text-button" href="/?forgot">Request a new link</a></div>}
      <button type="submit" className="primary auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}Save new password</button>
    </form>
  </div>;
}
