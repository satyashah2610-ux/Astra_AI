import { useCallback, useState } from 'react';
import ConfirmEmailPage from './ConfirmEmailPage';
import ResetPasswordPage from './ResetPasswordPage';
import StaffGate from './StaffGate';
import { confirmTokenFromLocation, resetTokenFromLocation } from './auth';
import SigningPage from './SigningPage';
import { tokenFromLocation } from './signing';

/** Signing links (`/sign#<token>`) open the public signing page; everything else is the staff workspace, behind a login. */
export default function Root({ path, hash }: { path: string; hash: string }) {
  const token = tokenFromLocation(path, hash);
  if (token) return <SigningPage token={token} />;
  const reset = resetTokenFromLocation(path, hash);
  if (reset) return <ResetPasswordPage token={reset} />;
  return <ConfirmThenWorkspace confirm={confirmTokenFromLocation(path, hash)} />;
}

/** A confirmation link first (`/confirm-email#<token>`), then the workspace: logged in after confirming, or the login
 * page with the reason when the link was already used. The used link leaves the address bar and history. */
function ConfirmThenWorkspace({ confirm }: { confirm: string | null }) {
  const [finished, setFinished] = useState<{ notice?: string } | null>(confirm ? null : {});
  const onFinished = useCallback((notice?: string) => {
    window.history.replaceState(null, '', '/');
    setFinished({ notice });
  }, []);
  if (!finished) return <ConfirmEmailPage token={confirm!} onFinished={onFinished} />;
  return <StaffGate notice={finished.notice} />;
}
