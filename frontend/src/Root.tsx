import App from './App';
import SigningPage from './SigningPage';
import { tokenFromPath } from './signing';

/** Signing links open the public signing page; every other path is the staff workspace. */
export default function Root({ path }: { path: string }) {
  const token = tokenFromPath(path);
  return token ? <SigningPage token={token} /> : <App />;
}
