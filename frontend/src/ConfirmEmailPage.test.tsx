import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
import { confirmTokenFromLocation } from './auth';

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
let calls: { url: string; body?: any }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  calls = []; answer = { status: 200, body: { message: 'Email confirmed. Log in to continue.' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body as string) : undefined });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const password = () => screen.getByLabelText('Password', { exact: true });
async function confirmWith(value: string) {
  await userEvent.type(password(), value);
  await userEvent.click(screen.getByRole('button', { name: 'Confirm email' }));
}

it('reads the token only from /confirm-email#<token>', () => {
  expect(confirmTokenFromLocation('/confirm-email', `#${token}`)).toBe(token);
  for (const [path, hash] of [['/', `#${token}`], ['/confirm-email', ''], ['/confirm-email', '#short'], ['/reset-password', `#${token}`]]) {
    expect(confirmTokenFromLocation(path, hash)).toBeNull();
  }
});

it('asks for the account password before confirming, then links to log in', async () => {
  window.history.replaceState(null, '', `/confirm-email#${token}`);
  render(<ConfirmEmailPage token={token} />);
  expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(calls).toHaveLength(0);  // nothing happens just by opening the link
  await confirmWith('correct horse battery');
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Email confirmed. Log in to continue.');
  expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/');
  expect(calls).toEqual([{ url: '/api/auth/confirm', body: { token, password: 'correct horse battery' } }]);
  expect(window.location.hash).toBe('');
});

it('a wrong password can be corrected and tried again', async () => {
  answer = { status: 401, body: { detail: 'That password doesn’t match this account.' } };
  render(<ConfirmEmailPage token={token} />);
  await confirmWith('wrong password');
  expect(await screen.findByRole('alert')).toHaveTextContent('That password doesn’t match this account.');
  expect(password()).toHaveValue('');
  answer = { status: 200, body: { message: 'Email confirmed. Log in to continue.' } };
  await confirmWith('correct horse battery');
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
});

it('an invalid or expired link says so and points to log in', async () => {
  answer = { status: 400, body: { detail: 'This confirmation link is invalid or has expired. Log in to send a new one.' } };
  render(<ConfirmEmailPage token={token} />);
  await confirmWith('correct horse battery');
  expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired');
  expect(screen.queryByLabelText('Password', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/');
});

it('a server problem keeps the form so it can be tried again', async () => {
  answer = { status: 503, body: { detail: 'The service is busy. Try again.' } };
  render(<ConfirmEmailPage token={token} />);
  await confirmWith('correct horse battery');
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm email' })).toBeEnabled();
});

it('opens from the emailed link without checking a login', async () => {
  const { default: Root } = await import('./Root');
  render(<Root path="/confirm-email" hash={`#${token}`} />);
  expect(screen.getByRole('heading', { name: 'Confirm your email' })).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});
