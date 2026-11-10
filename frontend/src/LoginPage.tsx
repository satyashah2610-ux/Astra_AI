import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Mail, Sparkles, UserPlus } from 'lucide-react';
import { ApiError } from './api';
import { authApi, type Account } from './auth';

type Mode = 'login' | 'signup' | 'forgot';
type Values = { company: string; name: string; email: string; password: string };
type Errors = Partial<Record<keyof Values, string>>;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function check(values: Values, mode: Mode): Errors {
  const errors: Errors = {};
  if (mode === 'signup' && !values.company.trim()) errors.company = 'Enter your company name.';
  if (mode === 'signup' && !values.name.trim()) errors.name = 'Enter your name.';
  if (!EMAIL.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  if (mode === 'signup' && values.password.length < 10) errors.password = 'Use at least 10 characters.';
  if (mode === 'login' && !values.password) errors.password = 'Enter your password.';
  return errors;
}

/** Staff log in or create their company's account. Signers never see this page. */
export default function LoginPage({ onSignedIn, notice = '' }: { onSignedIn: (account: Account) => void; notice?: string }) {
  // A '/?forgot' link (from an expired reset email) opens straight on the reset request.
  // The flag is dropped from the address bar once read, so a later log-out doesn't land here again.
  const [mode, setMode] = useState<Mode>(() => {
    if (!new URLSearchParams(window.location.search).has('forgot')) return 'login';
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    return 'forgot';
  });
  const [sent, setSent] = useState('');
  const [created, setCreated] = useState(notice);  // "Account created" (or a notice such as "account deleted"): shown above the login form
  const [values, setValues] = useState<Values>({ company: '', name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);  // right password, email not confirmed yet: offer a new link
  const [showPassword, setShowPassword] = useState(false);

  const set = (key: keyof Values, value: string) => { setValues(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };
  function switchTo(next: Mode) { setMode(next); setErrors({}); setError(''); setSent(''); setCreated(''); setShowPassword(false); setUnconfirmed(false); }

  async function resend() {
    setBusy(true);
    try { const { message } = await authApi.resendConfirmation(values.email.trim()); setError(''); setUnconfirmed(false); setCreated(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check(values, mode);
    setErrors(found); setError(''); setCreated(''); setUnconfirmed(false);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const email = values.email.trim();
      if (mode === 'forgot') { setSent((await authApi.forgot(email)).message); return; }
      if (mode === 'login') { onSignedIn(await authApi.login(email, values.password)); return; }
      const { message } = await authApi.signup({ company: values.company.trim(), name: values.name.trim(), email, password: values.password });
      switchTo('login');  // the new account logs in like any other, with the email already filled in
      set('password', '');
      setCreated(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setUnconfirmed(mode === 'login' && e instanceof ApiError && e.status === 403);
      if (mode === 'login') set('password', '');
    } finally { setBusy(false); }
  }

  // Directly in the column (no wrapper) so every box is full width, like the password row.
  const input = (key: keyof Values, type: string, autoComplete: string) => <input id={`auth-${key}`} type={key === 'password' && showPassword ? 'text' : type} value={values[key]}
    autoComplete={autoComplete} disabled={busy} maxLength={key === 'email' ? 254 : 200} aria-invalid={Boolean(errors[key])}
    aria-describedby={errors[key] ? `auth-${key}-error` : undefined} onChange={e => set(key, e.target.value)} />;
  const field = (key: keyof Values, label: string, type = 'text', autoComplete = 'off') => <div className={`form-field ${errors[key] ? 'invalid' : ''}`}>
    <label htmlFor={`auth-${key}`}>{label}</label>
    {key === 'password'
      ? <div className="password-row">{input(key, type, autoComplete)}
          <button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      : input(key, type, autoComplete)}
    {errors[key] && <small className="field-error" id={`auth-${key}-error`}>{errors[key]}</small>}
  </div>;

  if (mode === 'forgot') return <div className="auth-shell">
    <form className="auth-card" noValidate onSubmit={event => void submit(event)} aria-labelledby="auth-title">
      <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={20} strokeWidth={1.6} /></span>Astra Sign</span>
      <h1 id="auth-title">Reset your password</h1>
      {sent ? <p className="auth-intro sent-note" role="status">{sent} The link works once and expires in 1 hour. Check your spam folder if it doesn’t arrive.</p>
        : <><p className="auth-intro">Enter the email you use for Astra Sign and we’ll send you a link to choose a new password.</p>
          {field('email', 'Work email', 'email', 'email')}
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button type="submit" className="primary auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Mail size={16} />}Send reset link</button></>}
      <p className="auth-switch"><button type="button" className="text-button" onClick={() => switchTo('login')}>Back to log in</button></p>
    </form>
  </div>;

  return <div className="auth-shell">
    <form className="auth-card" noValidate onSubmit={event => void submit(event)} aria-labelledby="auth-title">
      <span className="brand auth-brand"><span className="brand-icon"><Sparkles size={20} strokeWidth={1.6} /></span>Astra Sign</span>
      <h1 id="auth-title">{mode === 'login' ? 'Log in to Astra Sign' : 'Create your company account'}</h1>
      {created && <p className="auth-intro sent-note" role="status">{created}</p>}
      <p className="auth-intro">{mode === 'login' ? 'Prepare agreements, send them to clients and keep every signed copy with its file.' : 'Your clients never need an account: they sign from a secure link.'}</p>
      {mode === 'signup' && field('company', 'Company name', 'text', 'organization')}
      {mode === 'signup' && field('name', 'Your name', 'text', 'name')}
      {field('email', 'Work email', 'email', 'email')}
      {field('password', 'Password', 'password', mode === 'login' ? 'current-password' : 'new-password')}
      {mode === 'login' && <button type="button" className="text-button forgot-link" onClick={() => switchTo('forgot')}>Forgot password?</button>}
      {mode === 'signup' && !errors.password && <small className="field-hint">At least 10 characters. A short phrase is easiest to remember.</small>}
      {error && <div className="error-banner" role="alert"><span>{error}</span>
        {unconfirmed && <button type="button" className="text-button" disabled={busy} onClick={() => void resend()}>Send a new confirmation link</button>}</div>}
      <button type="submit" className="primary auth-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}{mode === 'login' ? 'Log in' : 'Create account'}</button>
      <p className="auth-switch">{mode === 'login'
        ? <>New to Astra Sign? <button type="button" className="text-button" onClick={() => switchTo('signup')}>Create an account</button></>
        : <>Already have an account? <button type="button" className="text-button" onClick={() => switchTo('login')}>Log in instead</button></>}</p>
    </form>
  </div>;
}
