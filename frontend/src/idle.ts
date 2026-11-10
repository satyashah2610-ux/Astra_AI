import { useEffect, useRef } from 'react';

export const IDLE_MS = 10 * 60_000;  // the server ends a session unused this long, too
export const IDLE_NOTICE = 'You were logged out after 10 minutes without activity.';
export const LAST_ACTIVITY_KEY = 'astra:last-activity';  // shared by every tab of the app
const PING_MS = 60_000;  // while active, tell the server at most this often
const CHECK_MS = 15_000;
const SHARE_MS = 5_000;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'];

function sharedActivity(): number {
  try { return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0; } catch { return 0; }
}

/** Calls `onIdle` once after 10 minutes without a click, key, scroll, touch or mouse move here or in another tab of
 * the app. While the user is active, `keepAlive` tells the server about once a minute, so work that doesn't save
 * anything (placing boxes, reading) never times out. */
export function useIdleLogout(onIdle: () => void, keepAlive: () => Promise<unknown>) {
  const callbacks = useRef({ onIdle, keepAlive });
  callbacks.current = { onIdle, keepAlive };  // the latest ones, without restarting the clock on every render
  useEffect(() => {
    let last = Date.now(), lastPing = Date.now() - PING_MS, lastShared = 0, done = false;
    const activity = () => {
      const now = Date.now();
      last = now;
      if (now - lastShared >= SHARE_MS) {
        lastShared = now;
        try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* private window: this tab only */ }
      }
      if (now - lastPing >= PING_MS) { lastPing = now; void callbacks.current.keepAlive().catch(() => undefined); }
    };
    const timer = setInterval(() => {
      if (!done && Date.now() - Math.max(last, sharedActivity()) >= IDLE_MS) { done = true; callbacks.current.onIdle(); }
    }, CHECK_MS);
    ACTIVITY.forEach(type => window.addEventListener(type, activity, { capture: true, passive: true }));
    return () => {
      clearInterval(timer);
      ACTIVITY.forEach(type => window.removeEventListener(type, activity, { capture: true }));
    };
  }, []);
}
