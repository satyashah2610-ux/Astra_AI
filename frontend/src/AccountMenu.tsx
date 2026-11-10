import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, LogOut, Trash2 } from 'lucide-react';
import { ApiError, LOGGED_OUT_EVENT } from './api';
import { authApi, DELETE_ACCOUNT_PHRASE, type Account } from './auth';
import { initialsFrom } from './items';

type Props = { account: Account; onLogout: () => void; onDeleted: () => void };

/** The initials in the header open a menu: Log out, or Delete account (after typing the confirmation phrase). */
export default function AccountMenu({ account, onLogout, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {  // close on Escape or a click outside the menu
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (deleting) dialog.current?.showModal?.(); }, [deleting]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus(); }, [open]);  // keyboard users land in the menu

  function moveFocus(event: React.KeyboardEvent) {  // Up/Down move between the items, wrapping around
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const matches = typed === DELETE_ACCOUNT_PHRASE;  // exactly: same capitals, no extra spaces
  function startDelete() { setOpen(false); setTyped(''); setError(''); setDeleting(true); }
  async function confirmDelete(event: FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setBusy(true); setError('');
    try { await authApi.deleteAccount(typed); onDeleted(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { window.dispatchEvent(new Event(LOGGED_OUT_EVENT)); return; }  // session ended: back to login
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
    finally { setBusy(false); }
  }

  return <div className="account-menu" ref={root}>
    <button ref={trigger} className="avatar" aria-label={`Account menu, signed in as ${account.user.name}`} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(value => !value)}>{initialsFrom(account.user.name).slice(0, 2)}</button>
    {open && <div ref={menu} className="account-dropdown" role="menu" aria-label="Account" onKeyDown={moveFocus}>
      <button role="menuitem" onClick={() => { setOpen(false); onLogout(); }}><LogOut size={15} />Log out</button>
      <button role="menuitem" className="danger-text" onClick={startDelete}><Trash2 size={15} />Delete account</button>
    </div>}

    {deleting && <dialog ref={dialog} open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined}
      onCancel={e => { e.preventDefault(); if (!busy) setDeleting(false); }} aria-labelledby="delete-account-title">
      <form onSubmit={event => void confirmDelete(event)}>
        <h2 id="delete-account-title">Delete account?</h2>
        <p>This permanently deletes <strong>{account.organization.name}</strong>: your login, every agreement and file, all signed PDFs and their timelines. Signing links you’ve sent will stop working. This cannot be undone.</p>
        <div className="form-field">
          <label htmlFor="delete-account-confirm">Type <strong>“{DELETE_ACCOUNT_PHRASE}”</strong> to confirm</label>
          <input id="delete-account-confirm" value={typed} autoComplete="off" disabled={busy} maxLength={100} onChange={e => setTyped(e.target.value)} />
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="dialog-actions">
          <button type="button" autoFocus className="secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button>
          <button type="submit" className="danger" disabled={!matches || busy}>{busy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}Delete account permanently</button>
        </div>
      </form>
    </dialog>}
  </div>;
}
