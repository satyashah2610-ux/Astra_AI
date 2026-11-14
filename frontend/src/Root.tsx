import { useCallback, useState } from 'react';
import ConfirmEmailPage from './ConfirmEmailPage';
import ResetPasswordPage from './ResetPasswordPage';
import StaffGate from './StaffGate';
import { confirmTokenFromLocation, resetTokenFromLocation } from './auth';
import SigningPage from './SigningPage';
import { tokenFromLocation } from './signing';

/** Signing links (`/sign#<token>`) open the public signing page; everything else is the staff workspace, behind a login.
 * A logged-out visitor at a plain `/` sees the landing page first; `/login` goes straight to the login form. */
export default function Root({ path, hash, search = '' }: { path: string; hash: string; search?: string }) {
  const token = tokenFromLocation(path, hash);
  if (token) return <SigningPage token={token} />;
  const reset = resetTokenFromLocation(path, hash);
  if (reset) return <ResetPasswordPage token={reset} />;
  return <ConfirmThenWorkspace confirm={confirmTokenFromLocation(path, hash)} landing={path === '/' && !new URLSearchParams(search).has('forgot')} />;
}

/** A confirmation link first (`/confirm-email#<token>`), then the workspace: logged in after confirming, or the login
 * page with the reason when the link was already used. The used link leaves the address bar and history. */
function ConfirmThenWorkspace({ confirm, landing }: { confirm: string | null; landing: boolean }) {
  const [finished, setFinished] = useState<{ notice?: string } | null>(confirm ? null : {});
  const onFinished = useCallback((notice?: string) => {
    window.history.replaceState(null, '', '/');
    setFinished({ notice });
  }, []);
  if (!finished) return <ConfirmEmailPage token={confirm!} onFinished={onFinished} />;
  return <StaffGate notice={finished.notice} landing={landing} />;
}
