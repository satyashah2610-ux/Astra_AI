import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';
import StaffGate from './StaffGate';
import { LOGGED_OUT_EVENT } from './api';

vi.mock('./App', () => ({ default: ({ account, onLogout, onAccountDeleted }: any) => <div>
  <p>Workspace of {account.organization.name}</p>
  <button onClick={onLogout}>Log out</button>
  <button onClick={onAccountDeleted}>Account deleted</button>
</div> }));

const account = { user: { id: 'u1', name: 'Ana Lopez', email: 'ana@riverside.example' }, organization: { id: 'o1', name: 'Riverside Builders' } };
let requests: { method: string; url: string; body?: any }[];
let session: boolean;
let failSignup: string | null;

beforeEach(() => {
  requests = []; session = false; failSignup = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body as string) : undefined;
    requests.push({ method, url, body });
    const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });
    if (url === '/api/auth/me') return session ? json(account) : json({ detail: 'Log in to continue.' }, 401);
    if (url === '/api/auth/resend-confirmation') return json({ message: 'If that account still needs confirming, we’ve sent a new link.' }, 202);
    if (url === '/api/auth/login') {
      if (body.email === 'new@riverside.example') return json({ detail: 'Confirm your email address first: use the link we sent you, or send a new one.' }, 403);
      if (body.email === 'locked@riverside.example') return json({ detail: 'Too many failed attempts. Wait 15 minutes, or reset your password.' }, 429);
      if (body.password !== 'correct horse battery') return json({ detail: 'Email or password is incorrect.' }, 401);
      session = true; return json(account);
    }
    if (url === '/api/auth/signup') {
      if (failSignup) return json({ detail: failSignup }, 409);
      return json({ message: 'Account created. Log in to continue.' }, 201);  // no session until they log in
    }
    if (url === '/api/auth/logout') { session = false; return json(null, 204); }
    return json({ detail: 'Unexpected' }, 500);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const field = (label: string) => screen.getByLabelText(label);

it('logs in with email and password', async () => {
  const onSignedIn = vi.fn();
  render(<LoginPage onSignedIn={onSignedIn} />);
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(account));
  expect(requests.at(-1)).toEqual({ method: 'POST', url: '/api/auth/login', body: { email: 'ana@riverside.example', password: 'correct horse battery' } });
});

it('shows the server’s message when the login is wrong, and keeps the email', async () => {
  render(<LoginPage onSignedIn={vi.fn()} />);
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'wrong password');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  expect(field('Work email')).toHaveValue('ana@riverside.example');
  expect(field('Password')).toHaveValue('');
});

it('creates a company account, checking the fields first, then asks them to log in', async () => {
  const onSignedIn = vi.fn();
  render(<LoginPage onSignedIn={onSignedIn} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  expect(screen.getByText('Your clients never need an account: they sign from a secure link.')).toBeInTheDocument();
  expect(screen.queryByText(/one account per company/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('Enter your company name.')).toBeInTheDocument();
  expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
  expect(requests).toHaveLength(0);
  await userEvent.type(field('Company name'), 'Riverside Builders');
  await userEvent.type(field('Your name'), 'Ana Lopez');
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Account created. Log in to continue.');
  expect(requests.at(-1)!.body).toEqual({ company: 'Riverside Builders', name: 'Ana Lopez', email: 'ana@riverside.example', password: 'correct horse battery' });
  expect(onSignedIn).not.toHaveBeenCalled();  // not straight into the workspace
  expect(screen.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(field('Work email')).toHaveValue('ana@riverside.example');  // ready to log in
  expect(field('Password')).toHaveValue('');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(account));
});

it('explains an email that already has an account', async () => {
  failSignup = 'An account with this email already exists. Log in instead.';
  render(<LoginPage onSignedIn={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  await userEvent.type(field('Company name'), 'Riverside Builders');
  await userEvent.type(field('Your name'), 'Ana Lopez');
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
});

it('the password can be shown while typing', async () => {
  render(<LoginPage onSignedIn={vi.fn()} />);
  expect(field('Password')).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(field('Password')).toHaveAttribute('type', 'text');
});

// --- the gate in front of the staff workspace ------------------------------------------------------

it('shows the login page when there is no session, then the workspace after logging in', async () => {
  render(<StaffGate />);
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByText('Workspace of Riverside Builders')).toBeInTheDocument();
});

it('opens the workspace directly when already logged in, and logs out', async () => {
  session = true;
  render(<StaffGate />);
  expect(await screen.findByText('Workspace of Riverside Builders')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(requests.some(r => r.url === '/api/auth/logout' && r.method === 'POST')).toBe(true);
});

it('returns to the login page when the session expires mid-use', async () => {
  session = true;
  render(<StaffGate />);
  await screen.findByText('Workspace of Riverside Builders');
  session = false;
  await act(async () => { window.dispatchEvent(new Event(LOGGED_OUT_EVENT)); });
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
});

it('says the server can’t be reached (not "log in") when it is down, and recovers on Retry', async () => {
  session = true;
  let down = true;
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (down && url === '/api/auth/me') return new Response(JSON.stringify({ detail: 'Internal Server Error' }), { status: 500 });
    return realFetch(url, options);
  }));
  render(<StaffGate />);
  expect(await screen.findByRole('heading', { name: 'Can’t reach Astra Sign' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Log in to Astra Sign' })).not.toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Workspace of Riverside Builders')).toBeInTheDocument();
});

it('treats a network failure the same way', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  render(<StaffGate />);
  expect(await screen.findByRole('heading', { name: 'Can’t reach Astra Sign' })).toBeInTheDocument();
});

// --- forgot password ---------------------------------------------------------------------------------

it('sends a reset link from the login page and shows the same confirmation for any email', async () => {
  const forgotCalls: any[] = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/auth/forgot') {
      forgotCalls.push(JSON.parse(options!.body as string));
      return new Response(JSON.stringify({ message: 'If an account exists for that email, we’ve sent a link to reset the password.' }), { status: 202 });
    }
    return realFetch(url, options);
  }));
  render(<LoginPage onSignedIn={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(forgotCalls).toHaveLength(0);
  await userEvent.type(field('Work email'), '  ana@riverside.example ');
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If an account exists for that email');
  expect(forgotCalls).toEqual([{ email: 'ana@riverside.example' }]);
  await userEvent.click(screen.getByRole('button', { name: 'Back to log in' }));
  expect(screen.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
});

it('opens on the reset request from a /?forgot link, then removes the flag from the address bar', async () => {
  window.history.replaceState(null, '', '/?forgot');
  render(<LoginPage onSignedIn={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
  window.history.replaceState(null, '', '/');
});

it('after sign-up, a failed login replaces the "Account created" note, and a shown password is hidden again', async () => {
  render(<LoginPage onSignedIn={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  await userEvent.type(field('Company name'), 'Riverside Builders');
  await userEvent.type(field('Your name'), 'Ana Lopez');
  await userEvent.type(field('Work email'), 'ana@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Account created');
  expect(field('Password')).toHaveAttribute('type', 'password');  // not left revealed on the login form
  await userEvent.type(field('Password'), 'wrong password');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();  // never both messages at once
});

it('after the account is deleted, the login page says so', async () => {
  session = true;
  render(<StaffGate />);
  await userEvent.click(await screen.findByRole('button', { name: 'Account deleted' }));
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Your account has been deleted.');
});

it('an unconfirmed account can ask for a new confirmation link', async () => {
  const onSignedIn = vi.fn();
  render(<LoginPage onSignedIn={onSignedIn} />);
  await userEvent.type(field('Work email'), 'new@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirm your email address first');
  await userEvent.click(screen.getByRole('button', { name: 'Send a new confirmation link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If that account still needs confirming, we’ve sent a new link.');
  expect(requests.at(-1)).toEqual({ method: 'POST', url: '/api/auth/resend-confirmation', body: { email: 'new@riverside.example' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onSignedIn).not.toHaveBeenCalled();
});

it('shows the lock message after too many failed attempts, with no resend button', async () => {
  render(<LoginPage onSignedIn={vi.fn()} />);
  await userEvent.type(field('Work email'), 'locked@riverside.example');
  await userEvent.type(field('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed attempts. Wait 15 minutes, or reset your password.');
  expect(screen.queryByRole('button', { name: 'Send a new confirmation link' })).not.toBeInTheDocument();
});
