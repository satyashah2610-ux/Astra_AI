import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResetPasswordPage from './ResetPasswordPage';
import { resetTokenFromLocation } from './auth';

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
let calls: any[];
let valid: boolean;

beforeEach(() => {
  calls = []; valid = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body as string) : undefined });
    if (url === '/api/auth/reset') {
      return valid ? new Response(JSON.stringify({ message: 'Your password has been reset. Log in with your new password.' })) : new Response(JSON.stringify({ detail: 'This reset link is invalid or has expired. Request a new one.' }), { status: 400 });
    }
    return new Response('{}', { status: 500 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const field = (label: string) => screen.getByLabelText(label, { exact: true });

it('reads the reset token only from /reset-password#<token>', () => {
  expect(resetTokenFromLocation('/reset-password', `#${token}`)).toBe(token);
  expect(resetTokenFromLocation('/reset-password/', `#${token}`)).toBe(token);
  for (const [path, hash] of [['/', `#${token}`], ['/reset-password', ''], ['/reset-password', '#short'], ['/sign', `#${token}`]]) {
    expect(resetTokenFromLocation(path, hash)).toBeNull();
  }
});

it('checks the new password before sending it', async () => {
  render(<ResetPasswordPage token={token} />);
  expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  await userEvent.type(field('New password'), 'short');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
  await userEvent.clear(field('New password'));
  await userEvent.type(field('New password'), 'a brand new passphrase');
  await userEvent.type(field('Confirm new password'), 'a different passphrase');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(screen.getByText('The passwords don’t match.')).toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

it('saves the new password with the token from the link, then sends them to log in', async () => {
  window.history.replaceState(null, '', `/reset-password#${token}`);
  render(<ResetPasswordPage token={token} />);
  await userEvent.type(field('New password'), 'a brand new passphrase');
  await userEvent.type(field('Confirm new password'), 'a brand new passphrase');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Your password has been reset. Log in with your new password.');
  expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/');
  expect(screen.queryByLabelText('New password', { exact: true })).not.toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/auth/reset', body: { token, password: 'a brand new passphrase' } }]);
  expect(window.location.hash).toBe('');  // the used link leaves the address bar (and a reload doesn't show the form again)
  expect(screen.getByRole('region', { name: 'Password reset' })).toBeInTheDocument();
});

it('explains an invalid or expired link and offers a new one', async () => {
  valid = false;
  render(<ResetPasswordPage token={token} />);
  await userEvent.type(field('New password'), 'a brand new passphrase');
  await userEvent.type(field('Confirm new password'), 'a brand new passphrase');
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired');
  expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/?forgot');
});

it('opens the reset page from the emailed link, without checking a login', async () => {
  const { default: Root } = await import('./Root');
  render(<Root path="/reset-password" hash={`#${token}`} />);
  expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  expect(calls.some(call => call.url.startsWith('/api/auth/me'))).toBe(false);
});
