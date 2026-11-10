import { useEffect, useRef, useState } from 'react';
import { Loader2, LogIn, Sparkles } from 'lucide-react';
import { authApi } from './auth';

/** Opened from the emailed link `/confirm-email#<token>`: confirms the address once, then points to log in. */
export default function ConfirmEmailPage({ token }: { token: string }) {
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const started = useRef(false);  // the link works once: never send it twice (StrictMode runs effects twice)

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    authApi.confirm(token)
      .then(({ message }) => { setDone(message); window.history.replaceState(null, '', '/confirm-email'); })  // drop the used link
      .catch(e => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'));
  }, [token]);

  return <div className="auth-shell">
    <section className="auth-card" aria-labelledby="confirm-title">
      <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={20} strokeWidth={1.6} /></span>Astra Sign</span>
      <h1 id="confirm-title">{done ? 'Email confirmed' : error ? 'Link not valid' : 'Confirming your email…'}</h1>
      {done && <p className="auth-intro sent-note" role="status">{done}</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!done && !error && <p className="loading"><Loader2 className="spin" size={18} />One moment…</p>}
      {(done || error) && <a className="primary auth-submit" href="/"><LogIn size={16} />Go to log in</a>}
    </section>
  </div>;
}
