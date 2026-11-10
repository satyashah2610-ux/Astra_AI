import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConfirmEmailPage from './ConfirmEmailPage';
import { confirmTokenFromLocation } from './auth';

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
let calls: { url: string; body?: any }[];
let valid: boolean;

beforeEach(() => {
  calls = []; valid = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body as string) : undefined });
    return valid ? new Response(JSON.stringify({ message: 'Email confirmed. Log in to continue.' }))
      : new Response(JSON.stringify({ detail: 'This confirmation link is invalid or has expired. Log in to send a new one.' }), { status: 400 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('reads the token only from /confirm-email#<token>', () => {
  expect(confirmTokenFromLocation('/confirm-email', `#${token}`)).toBe(token);
  for (const [path, hash] of [['/', `#${token}`], ['/confirm-email', ''], ['/confirm-email', '#short'], ['/reset-password', `#${token}`]]) {
    expect(confirmTokenFromLocation(path, hash)).toBeNull();
  }
});

it('confirms once on opening (even in StrictMode), drops the link from the address bar and links to log in', async () => {
  window.history.replaceState(null, '', `/confirm-email#${token}`);
  render(<StrictMode><ConfirmEmailPage token={token} /></StrictMode>);
  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Email confirmed. Log in to continue.');
  expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/');
  expect(calls).toEqual([{ url: '/api/auth/confirm', body: { token } }]);
  expect(window.location.hash).toBe('');
});

it('explains an invalid or expired link', async () => {
  valid = false;
  render(<ConfirmEmailPage token={token} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/');
});

it('opens from the emailed link without checking a login', async () => {
  const { default: Root } = await import('./Root');
  render(<Root path="/confirm-email" hash={`#${token}`} />);
  await waitFor(() => expect(calls.map(call => call.url)).toEqual(['/api/auth/confirm']));
});
