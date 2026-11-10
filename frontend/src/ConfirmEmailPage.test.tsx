import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
import { confirmTokenFromLocation } from './auth';

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
let calls: { url: string; body?: any }[];
let answer: { status: number; body: unknown };
let usable: boolean;

beforeEach(() => {
  calls = []; usable = true; answer = { status: 200, body: { message: 'Email confirmed.' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body as string) : undefined });
    if (url === '/api/auth/confirm/check') return new Response(JSON.stringify({ valid: usable }), { status: 200 });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const password = () => screen.getByLabelText('Password', { exact: true });
async function confirmWith(value: string) {
  await userEvent.type(await screen.findByLabelText('Password', { exact: true }), value);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }));
}
const USED = 'This confirmation link has already been used or has expired. Log in to continue.';

it('reads the token only from /confirm-email#<token>', () => {
  expect(confirmTokenFromLocation('/confirm-email', `#${token}`)).toBe(token);
  for (const [path, hash] of [['/', `#${token}`], ['/confirm-email', ''], ['/confirm-email', '#short'], ['/reset-password', `#${token}`]]) {
    expect(confirmTokenFromLocation(path, hash)).toBeNull();
  }
});

it('asks for the password once, then goes straight into the app', async () => {
  window.history.replaceState(null, '', `/confirm-email#${token}`);
  const onFinished = vi.fn();
  render(<ConfirmEmailPage token={token} onFinished={onFinished} />);
  expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/auth/confirm/check', body: { token } }]);  // checking uses nothing up
  await confirmWith('correct horse battery');
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith());  // logged in: no notice, the app opens
  expect(calls.at(-1)).toEqual({ url: '/api/auth/confirm', body: { token, password: 'correct horse battery' } });
});

it('a used or expired link goes straight to the login page, without asking for a password', async () => {
  usable = false;
  const onFinished = vi.fn();
  render(<ConfirmEmailPage token={token} onFinished={onFinished} />);
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith(USED));
  expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

it('a link used up while the page was open also goes to the login page', async () => {
  answer = { status: 400, body: { detail: 'This confirmation link is invalid or has expired. Log in to send a new one.' } };
  const onFinished = vi.fn();
  render(<ConfirmEmailPage token={token} onFinished={onFinished} />);
  await confirmWith('correct horse battery');
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith(USED));
});

it('a wrong password can be corrected and tried again', async () => {
  answer = { status: 401, body: { detail: 'That password doesn’t match this account.' } };
  const onFinished = vi.fn();
  render(<ConfirmEmailPage token={token} onFinished={onFinished} />);
  await confirmWith('wrong password');
  expect(await screen.findByRole('alert')).toHaveTextContent('That password doesn’t match this account.');
  expect(password()).toHaveValue('');
  answer = { status: 200, body: { message: 'Email confirmed.' } };
  await confirmWith('correct horse battery');
  await waitFor(() => expect(onFinished).toHaveBeenCalledWith());
});

it('a server problem keeps the form so it can be tried again', async () => {
  answer = { status: 503, body: { detail: 'The service is busy. Try again.' } };
  const onFinished = vi.fn();
  render(<ConfirmEmailPage token={token} onFinished={onFinished} />);
  await confirmWith('correct horse battery');
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  expect(screen.getByRole('button', { name: 'Confirm email' })).toBeEnabled();
  expect(onFinished).not.toHaveBeenCalled();
});

it('from the emailed link, a used link shows the login page with the reason', async () => {
  usable = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/confirm/check') return new Response(JSON.stringify({ valid: false }), { status: 200 });
    return new Response(JSON.stringify({ detail: 'Log in to continue.' }), { status: 401 });  // /api/auth/me: not logged in
  }));
  const { default: Root } = await import('./Root');
  render(<Root path="/confirm-email" hash={`#${token}`} />);
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(screen.getByText(USED)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  expect(window.location.hash).toBe('');  // the used link leaves the address bar
});

it('opens from the emailed link without checking a login', async () => {
  const { default: Root } = await import('./Root');
  render(<Root path="/confirm-email" hash={`#${token}`} />);
  expect(await screen.findByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(calls.map(call => call.url)).toEqual(['/api/auth/confirm/check']);  // no login check before confirming
});
