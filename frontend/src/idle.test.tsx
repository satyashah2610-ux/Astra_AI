import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDLE_NOTICE, LAST_ACTIVITY_KEY, useIdleLogout } from './idle';

const MINUTE = 60_000;

function Probe({ onIdle, keepAlive }: { onIdle: () => void; keepAlive: () => Promise<unknown> }) {
  useIdleLogout(onIdle, keepAlive);
  return <p>working</p>;
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
  const onIdle = vi.fn(), keepAlive = vi.fn(async () => undefined);
  render(<Probe onIdle={onIdle} keepAlive={keepAlive} />);
  return { onIdle, keepAlive };
}

it('logs out after 10 minutes without any activity', () => {
  const { onIdle } = setup();
  act(() => { vi.advanceTimersByTime(9.5 * MINUTE); });
  expect(onIdle).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(0.75 * MINUTE); });
  expect(onIdle).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(5 * MINUTE); });
  expect(onIdle).toHaveBeenCalledTimes(1);  // once
});

it.each(['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'])('%s counts as activity', type => {
  const { onIdle } = setup();
  act(() => { vi.advanceTimersByTime(8 * MINUTE); });
  fireEvent(window, new Event(type));
  act(() => { vi.advanceTimersByTime(8 * MINUTE); });  // 16 minutes in, 8 since the activity
  expect(onIdle).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(2.5 * MINUTE); });
  expect(onIdle).toHaveBeenCalled();
});

it('redrawing the page does not restart the clock', () => {
  const onIdle = vi.fn(), keepAlive = vi.fn(async () => undefined);
  const view = render(<Probe onIdle={onIdle} keepAlive={keepAlive} />);
  act(() => { vi.advanceTimersByTime(6 * MINUTE); });
  view.rerender(<Probe onIdle={() => onIdle()} keepAlive={async () => undefined} />);  // new callbacks, no activity
  act(() => { vi.advanceTimersByTime(4.5 * MINUTE); });
  expect(onIdle).toHaveBeenCalled();
});

it('activity in another tab of the app counts too', () => {
  const { onIdle } = setup();
  act(() => { vi.advanceTimersByTime(8 * MINUTE); });
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));  // written by the other tab
  act(() => { vi.advanceTimersByTime(8 * MINUTE); });
  expect(onIdle).not.toHaveBeenCalled();
});

it('while active, the server is told about once a minute so the session stays alive', () => {
  const { keepAlive } = setup();
  act(() => { vi.advanceTimersByTime(3 * MINUTE); });
  expect(keepAlive).not.toHaveBeenCalled();  // no activity: nothing to report
  fireEvent.keyDown(window);
  expect(keepAlive).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window);
  act(() => { vi.advanceTimersByTime(30_000); });
  fireEvent.keyDown(window);
  expect(keepAlive).toHaveBeenCalledTimes(1);  // not on every key
  act(() => { vi.advanceTimersByTime(31_000); });
  fireEvent.keyDown(window);
  expect(keepAlive).toHaveBeenCalledTimes(2);
});

it('the logged-in workspace logs out after 10 idle minutes and says why', async () => {
  const calls: string[] = [];
  const account = { user: { id: 'u', name: 'Ana Lopez', email: 'ana@x.co' }, organization: { id: 'o', name: 'Riverside' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push(`${options?.method ?? 'GET'} ${url}`);
    if (url === '/api/auth/me') return new Response(JSON.stringify(account), { status: 200 });
    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    return new Response('[]', { status: 200 });
  }));
  const { default: StaffGate } = await import('./StaffGate');
  render(<StaffGate />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByText('Riverside')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(10.5 * MINUTE); });
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(screen.getByText(IDLE_NOTICE)).toBeInTheDocument();
  expect(calls).toContain('POST /api/auth/logout');  // the server session ends too
});

it('when the server has ended the session, the login page says so', async () => {
  const account = { user: { id: 'u', name: 'Ana Lopez', email: 'ana@x.co' }, organization: { id: 'o', name: 'Riverside' } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/me') return new Response(JSON.stringify(account), { status: 200 });
    return new Response('[]', { status: 200 });
  }));
  const { default: StaffGate } = await import('./StaffGate');
  const { LOGGED_OUT_EVENT } = await import('./api');
  render(<StaffGate />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  act(() => { window.dispatchEvent(new Event(LOGGED_OUT_EVENT)); });  // a staff request answered 401
  expect(screen.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeInTheDocument();
  expect(screen.getByText('Your session has ended. Log in again to continue.')).toBeInTheDocument();
});
