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
  const confirm = confirmTokenFromLocation(path, hash);
  if (confirm) return <ConfirmEmailPage token={confirm} />;
  return <StaffGate />;
}
