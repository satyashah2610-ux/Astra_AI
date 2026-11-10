import StaffGate from './StaffGate';
import SigningPage from './SigningPage';
import { tokenFromLocation } from './signing';

/** Signing links (`/sign#<token>`) open the public signing page; everything else is the staff workspace, behind a login. */
export default function Root({ path, hash }: { path: string; hash: string }) {
  const token = tokenFromLocation(path, hash);
  return token ? <SigningPage token={token} /> : <StaffGate />;
}
