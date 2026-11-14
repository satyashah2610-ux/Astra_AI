import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Landing, { DEMO_STEPS } from './Landing';
import Root from './Root';
import { TestPointerEvent } from './test-utils';

vi.mock('./App', () => ({ default: ({ onLogout }: any) => <div><p>Workspace</p><button onClick={onLogout}>Log out</button></div> }));

let session: boolean;
beforeEach(() => {
  session = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me' && session
    ? new Response(JSON.stringify({ user: { id: 'u1', name: 'Ana', email: 'a@x.example' }, organization: { id: 'o1', name: 'Riverside' } }))
    : new Response(JSON.stringify({ detail: 'Log in to continue.' }), { status: 401 })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

const demo = () => screen.getByRole('region', { name: 'Product demo: one file from draft to signed' });
/** Let the clip run for `steps` steps, one timer at a time (each step schedules the next). */
const play = (steps: number) => { for (let i = 0; i < steps; i++) act(() => { vi.advanceTimersByTime(2000); }); };
const shown = () => within(demo()).getAllByRole('listitem').map(item => item.dataset.event);

it('leads to log in and to creating an account', () => {
  render(<Landing />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Send the agreement. Watch it get signed.');
  expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
  expect(screen.getAllByRole('link', { name: /Start free/ })[0]).toHaveAttribute('href', '/login?signup');
});

it('has no "See it in action" button', () => {
  render(<Landing />);
  expect(screen.queryByRole('link', { name: 'See it in action' })).not.toBeInTheDocument();
});

it('nav links scroll to their section on the first click, without changing the address', () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView ??= () => {};  // jsdom has none; spyOn needs one to wrap
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) { scrolled.push(this.id); });
  render(<Landing />);
  for (const [name, id] of [['Features', 'features'], ['How it works', 'how'], ['Security', 'security']]) {
    fireEvent.click(screen.getByRole('link', { name }));
    expect(scrolled.at(-1)).toBe(id);
  }
  expect(window.location.hash).toBe('');  // a hash change would reload the page (main.tsx)
});

it('the product window tilts toward the mouse and settles when it leaves', () => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);  // jsdom has none
  render(<Landing />);
  const window_ = demo();
  window_.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON() {} });
  fireEvent.pointerMove(window_, { clientX: 400, clientY: 0 });
  expect(window_.style.getPropertyValue('--tilt-y')).toBe('6deg');
  expect(window_.style.getPropertyValue('--tilt-x')).toBe('4deg');
  fireEvent.pointerLeave(window_);
  expect(window_.style.getPropertyValue('--tilt-y')).toBe('0deg');
});

it('plays the timeline like a clip: events appear in order until the file is signed', () => {
  vi.useFakeTimers();
  render(<Landing />);
  expect(shown()).toEqual(['created']);
  expect(within(demo()).getByTestId('demo-status')).toHaveTextContent('Draft');
  play(DEMO_STEPS.length - 1);
  expect(shown()).toEqual(['created', 'sent', 'email_sent', 'reminder_sent', 'viewed', 'signed', 'signed_notice_sent']);
  expect(within(demo()).getByTestId('demo-status')).toHaveTextContent('Signed');
  expect(within(demo()).getByText('Opened by signer')).toBeInTheDocument();
});

it('can be paused and played again', () => {
  vi.useFakeTimers();
  render(<Landing />);
  fireEvent.click(screen.getByRole('button', { name: 'Pause demo' }));
  play(10);
  expect(shown()).toEqual(['created']);
  fireEvent.click(screen.getByRole('button', { name: 'Play demo' }));
  play(1);
  expect(shown()).toEqual(['created', 'sent']);
});

it('shows the whole timeline without motion when the visitor asks for reduced motion', () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
  render(<Landing />);
  expect(shown()).toHaveLength(DEMO_STEPS.length);
  expect(screen.getByRole('button', { name: 'Play demo' })).toBeInTheDocument();
});

// --- where the landing page sits -------------------------------------------------------------------

it('greets a logged-out visitor at / with the landing page, and /login with the login form', async () => {
  const { unmount } = render(<Root path="/" hash="" />);
  expect(await screen.findByRole('heading', { name: 'Send the agreement. Watch it get signed.' })).toBeInTheDocument();
  unmount();
  render(<Root path="/login" hash="" />);
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
});

it('still opens the password reset request from the /?forgot link in emails', async () => {
  window.history.replaceState(null, '', '/?forgot');
  render(<Root path="/" hash="" search="?forgot" />);
  expect(await screen.findByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  window.history.replaceState(null, '', '/');
});

it('after logging in at /login, shows the workspace at / and returns to the login form on log out', async () => {
  window.history.replaceState(null, '', '/login');
  render(<Root path="/login" hash="" />);
  await screen.findByRole('heading', { name: 'Log in to Astra Sign' });
  session = true;
  await userEvent.type(screen.getByLabelText('Work email'), 'a@x.example');
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ user: { id: 'u1', name: 'Ana', email: 'a@x.example' }, organization: { id: 'o1', name: 'Riverside' } })));
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(await screen.findByText('Workspace')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
  await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
});

it('shows the landing page for links with tracking parameters', async () => {
  render(<Root path="/" hash="" search="?utm_source=newsletter" />);
  expect(await screen.findByRole('heading', { name: 'Send the agreement. Watch it get signed.' })).toBeInTheDocument();
});

it('logging out at / moves the address to /login, so a refresh shows the login form, not the landing page', async () => {
  session = true;
  render(<Root path="/" hash="" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));
  expect(await screen.findByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/login');
});

it('treats /login/ like /login: the workspace moves to /', async () => {
  session = true;
  window.history.replaceState(null, '', '/login/');
  render(<Root path="/login/" hash="" />);
  expect(await screen.findByText('Workspace')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

it('takes a logged-in user at / straight to the workspace', async () => {
  session = true;
  render(<Root path="/" hash="" />);
  expect(await screen.findByText('Workspace')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Send the agreement. Watch it get signed.' })).not.toBeInTheDocument();
});
