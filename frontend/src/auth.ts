import { request } from './api';

export type Account = { user: { id: string; name: string; email: string }; organization: { id: string; name: string } };
export type SignupValues = { company: string; name: string; email: string; password: string };

const json = { 'Content-Type': 'application/json' };
export const authApi = {
  me: () => request<Account>('/api/auth/me'),
  login: (email: string, password: string) => request<Account>('/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ email, password }) }),
  signup: (values: SignupValues) => request<Account>('/api/auth/signup', { method: 'POST', headers: json, body: JSON.stringify(values) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};
