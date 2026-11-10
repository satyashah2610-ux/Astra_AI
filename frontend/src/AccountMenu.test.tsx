import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AccountMenu from './AccountMenu';
import { LOGGED_OUT_EVENT } from './api';

const account = { user: { id: 'u1', name: 'Ana Lopez', email: 'ana@riverside.example' }, organization: { id: 'o1', name: 'Riverside Builders' } };
let requests: { method: string; url: string; body?: any }[];
let fail: boolean;
let expired: boolean;

beforeEach(() => {
  requests = []; fail = false; expired = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    requests.push({ method: options.method ?? 'GET', url, body: options.body ? JSON.parse(options.body as string) : undefined });
    if (expired) return new Response(JSON.stringify({ detail: 'Log in to continue.' }), { status: 401 });
    if (fail) return new Response(JSON.stringify({ detail: 'Could not delete the account. Try again.' }), { status: 503 });
    return new Response(null, { status: 204 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function renderMenu() {
  const onLogout = vi.fn(), onDeleted = vi.fn();
  render(<AccountMenu account={account} onLogout={onLogout} onDeleted={onDeleted} />);
  return { onLogout, onDeleted };
}
const avatar = () => screen.getByRole('button', { name: /signed in as Ana Lopez/i });

it('the initials open a menu with Log out and Delete account', async () => {
  const { onLogout } = renderMenu();
  expect(avatar()).toHaveTextContent('AL');
  expect(avatar()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await userEvent.click(avatar());
  const menu = screen.getByRole('menu');
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Log out', 'Delete account']);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Log out' }));
  expect(onLogout).toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('closes the menu with Escape or a click elsewhere', async () => {
  renderMenu();
  await userEvent.click(avatar());
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await userEvent.click(avatar());
  await userEvent.click(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('deletes the account only after the exact phrase is typed', async () => {
  const { onDeleted } = renderMenu();
  await userEvent.click(avatar());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Riverside Builders');
  expect(dialog).toHaveTextContent(/cannot be undone/i);
  const confirm = within(dialog).getByRole('button', { name: 'Delete account permanently' });
  const box = within(dialog).getByLabelText('Type “I want to delete account” to confirm');
  expect(confirm).toBeDisabled();
  await userEvent.type(box, 'I want to delete');
  expect(confirm).toBeDisabled();
  await userEvent.type(box, ' acount');  // a typo is not enough
  expect(confirm).toBeDisabled();
  await userEvent.clear(box);
  await userEvent.type(box, 'I want to delete account ');  // only the exact phrase: no extra spaces
  expect(confirm).toBeDisabled();
  await userEvent.clear(box);
  await userEvent.type(box, 'i want to delete account');  // nor different capitals
  expect(confirm).toBeDisabled();
  await userEvent.clear(box);
  await userEvent.type(box, 'I want to delete account');
  expect(confirm).toBeEnabled();
  expect(requests).toHaveLength(0);
  await userEvent.click(confirm);
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(requests).toEqual([{ method: 'DELETE', url: '/api/auth/account', body: { confirm: 'I want to delete account' } }]);
});

it('cancelling or a server error keeps the account', async () => {
  const { onDeleted } = renderMenu();
  await userEvent.click(avatar());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(requests).toHaveLength(0);

  fail = true;
  await userEvent.click(avatar());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByLabelText('Type “I want to delete account” to confirm')).toHaveValue('');  // starts empty every time
  await userEvent.type(within(dialog).getByLabelText('Type “I want to delete account” to confirm'), 'I want to delete account');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account permanently' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not delete the account. Try again.');
  expect(onDeleted).not.toHaveBeenCalled();
});

it('an expired session while deleting returns to the login page', async () => {
  expired = true;
  const loggedOut = vi.fn();
  window.addEventListener(LOGGED_OUT_EVENT, loggedOut);
  const { onDeleted } = renderMenu();
  await userEvent.click(avatar());
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete account' }));
  await userEvent.type(screen.getByLabelText('Type “I want to delete account” to confirm'), 'I want to delete account');
  await userEvent.click(screen.getByRole('button', { name: 'Delete account permanently' }));
  await waitFor(() => expect(loggedOut).toHaveBeenCalled());
  expect(onDeleted).not.toHaveBeenCalled();
  window.removeEventListener(LOGGED_OUT_EVENT, loggedOut);
});

it('works with the keyboard: focus moves into the menu, arrows move, Escape returns to the initials', async () => {
  renderMenu();
  avatar().focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Delete account' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus();  // wraps around
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('menuitem', { name: 'Delete account' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(avatar()).toHaveFocus();
});
