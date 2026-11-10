import ResetPasswordPage from './ResetPasswordPage';
import StaffGate from './StaffGate';
import { resetTokenFromLocation } from './auth';
import SigningPage from './SigningPage';
import { tokenFromLocation } from './signing';

/** Signing links (`/sign#<token>`) open the public signing page; everything else is the staff workspace, behind a login. */
export default function Root({ path, hash }: { path: string; hash: string }) {
  const token = tokenFromLocation(path, hash);
  if (token) return <SigningPage token={token} />;
  const reset = resetTokenFromLocation(path, hash);
  if (reset) return <ResetPasswordPage token={reset} />;
  return <StaffGate />;
}
