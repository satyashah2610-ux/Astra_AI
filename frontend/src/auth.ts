import { request } from './api';

export type Account = { user: { id: string; name: string; email: string }; organization: { id: string; name: string } };
/** Typed by the user to confirm deleting the account; the server checks it too. */
export const DELETE_ACCOUNT_PHRASE = 'I want to delete account';
export type SignupValues = { company: string; name: string; email: string; password: string };

const json = { 'Content-Type': 'application/json' };
export const authApi = {
  me: () => request<Account>('/api/auth/me'),
  login: (email: string, password: string) => request<Account>('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email, password }) }),
  signup: (values: SignupValues) => request<{ message: string }>('/api/auth/signup', { method: 'POST', headers: json, body: JSON.stringify(values) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  deleteAccount: (confirm: string) => request<void>('/api/auth/account', { method: 'DELETE', headers: json, body: JSON.stringify({ confirm }) }),
  forgot: (email: string) => request<{ message: string }>('/api/auth/forgot', { method: 'POST', headers: json, body: JSON.stringify({ email }) }),
  confirm: (token: string) => request<{ message: string }>('/api/auth/confirm', { method: 'POST', headers: json, body: JSON.stringify({ token }) }),
  resendConfirmation: (email: string) => request<{ message: string }>('/api/auth/resend-confirmation', { method: 'POST', headers: json, body: JSON.stringify({ email }) }),
  reset: (token: string, password: string) => request<{ message: string }>('/api/auth/reset', { method: 'POST', headers: json, body: JSON.stringify({ token, password }) }),
};

/** The secret from a `/reset-password#<token>` link (fragments never reach servers or logs), or null. */
export function resetTokenFromLocation(path: string, hash: string): string | null {
  return /^\/reset-password\/?$/.test(path) ? /^#([A-Za-z0-9_-]{20,})$/.exec(hash)?.[1] ?? null : null;
}

/** The secret from a `/confirm-email#<token>` link, or null. */
export function confirmTokenFromLocation(path: string, hash: string): string | null {
  return /^\/confirm-email\/?$/.test(path) ? /^#([A-Za-z0-9_-]{20,})$/.exec(hash)?.[1] ?? null : null;
}
