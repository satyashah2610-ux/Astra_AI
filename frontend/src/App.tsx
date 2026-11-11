import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, FileSignature, FileText, Loader2, Pencil, Plus, Search, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { request, type Agreement, type Mark } from './api';
import PdfEditor from './PdfEditor';
import FilesPage from './FilesPage';
import AccountMenu from './AccountMenu';
import { isSignatureMark } from './items';
import type { Account } from './auth';

type Tab = 'agreements' | 'files';

export default function App({ account, onLogout, onAccountDeleted }: { account: Account; onLogout: () => void; onAccountDeleted: () => void }) {
  const [tab, setTabState] = useState<Tab>(() => window.location.pathname === '/files' ? 'files' : 'agreements');
  /** The tab is kept in the address, so a refresh opens the same page. */
  function setTab(next: Tab) { setTabState(next); window.history.replaceState(null, '', `/${next}`); }
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [active, setActive] = useState<Agreement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agreement | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);  // the name being typed, while renaming
  const cancelRename = useRef(false);  // Escape: the blur that follows must not save
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const pending = useRef<() => void>(() => {});
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = !!active && JSON.stringify(marks) !== JSON.stringify(active.marks);
  const signatureCount = marks.filter(isSignatureMark).length;

  function select(item: Agreement) { setActive(item); setMarks(item.marks); setError(''); setRenaming(null); }
  async function load() {
    setLoading(true); setError('');
    try {
      const list = await request<Agreement[]>('/api/agreements');
      setAgreements(list);
      if (list.length) select(list[0]);
      else { setActive(null); setMarks([]); }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => { if (confirm) dialog.current?.showModal?.(); }, [confirm]);
  useEffect(() => { if (deleteTarget) deleteDialog.current?.showModal?.(); }, [deleteTarget]);

  function guard(action: () => void) {
    if (busy) return;
    if (dirty) { pending.current = action; setConfirm(true); }
    else action();
  }
  async function upload(file: File) {
    setError('');
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Please choose a PDF file.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('PDF must be 20 MB or smaller.'); return; }
    setBusy(true);
    try {
      const data = new FormData(); data.append('file', file);
      const item = await request<Agreement>('/api/agreements', { method: 'POST', body: data });
      setAgreements(current => [item, ...current]); select(item); setTab('agreements'); setSearch('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function sample() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/sample-agreement.pdf');
      if (!response.ok) throw new Error('Could not load the sample agreement. Please try again.');
      await upload(new File([await response.blob()], 'Sample services agreement.pdf', { type: 'application/pdf' }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!active) return;
    setBusy(true); setError('');
    try {
      const item = await request<Agreement>(`/api/agreements/${active.id}/marks`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marks, version: active.version }) });
      setAgreements(current => current.map(a => a.id === item.id ? item : a)); select(item);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  /** Rename only: unsaved boxes stay as they are. A taken name comes back numbered, e.g. "Services (1)". */
  async function rename() {
    const name = renaming?.trim();
    setRenaming(null);
    if (!active || !name || name === active.name) return;
    setBusy(true); setError('');
    try {
      const item = await request<Agreement>(`/api/agreements/${active.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      setAgreements(current => current.map(a => a.id === item.id ? { ...a, name: item.name } : a));
      setActive(current => current && current.id === item.id ? { ...current, name: item.name } : current);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function deleteAgreement() {
    if (!deleteTarget || busy) return;
    setBusy(true); setDeleteError('');
    try {
      await request<void>(`/api/agreements/${deleteTarget.id}`, { method: 'DELETE' });
      const remaining = agreements.filter(item => item.id !== deleteTarget.id);
      setAgreements(remaining);
      if (active?.id === deleteTarget.id) {
        if (remaining.length) select(remaining[0]);
        else { setActive(null); setMarks([]); }
      }
      setSearch(''); setError(''); setDeleteTarget(null);
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setBusy(false); }
  }
  const filtered = agreements.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));

  return <div className="app">
    <aside className="sidebar">
      <a className="brand" href="/" onClick={e => { e.preventDefault(); guard(() => { setMarks(active?.marks || []); setTab('agreements'); }); }}><span className="brand-icon"><Sparkles size={22} strokeWidth={1.6} /></span>Astra Sign</a>
      <nav role="tablist" aria-label="Main navigation" aria-orientation="vertical">
        <button role="tab" title="Agreements" aria-selected={tab === 'agreements'} disabled={busy} onClick={() => tab !== 'agreements' && guard(() => { setMarks(active?.marks || []); setTab('agreements'); })}><FileText size={16} />Agreements</button>
        <button role="tab" title="Files" aria-selected={tab === 'files'} disabled={busy} onClick={() => tab !== 'files' && guard(() => { setMarks(active?.marks || []); setTab('files'); })}><FileSignature size={16} />Files</button>
      </nav>
      <div className="sidebar-account"><AccountMenu account={account} onLogout={() => guard(onLogout)} onDeleted={onAccountDeleted} /><span className="account-text"><strong>{account.organization.name}</strong><span>{account.user.name}</span></span></div>
    </aside>
    <main className="content">
      {tab === 'agreements' && <div className="page-heading"><div><h1>Agreements</h1><p>Upload a PDF once, mark where clients sign, and reuse it for every file.</p></div><button className="primary" disabled={busy || loading} onClick={() => input.current?.click()}>{busy ? <Loader2 className="spin" size={17} /> : <Plus size={18} />}Upload agreement</button></div>}
      <input ref={input} className="sr-only" tabIndex={-1} type="file" accept="application/pdf,.pdf" aria-label="Upload PDF file" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guard(() => void upload(file)); }} />
      {error && <div className="error-banner" role="alert"><span>{error}</span><div>{error.includes('another tab') && <button onClick={() => guard(() => { void load(); })}>Reload saved version</button>}{error.includes('server') && <button onClick={() => guard(() => { void load(); })}>Retry</button>}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div></div>}
      {/* Files stays mounted while hidden, so a just-shown signing link and any work in progress survive a tab switch. */}
      <div hidden={tab !== 'files'}><FilesPage agreements={agreements} active={tab === 'files'} /></div>
      {tab === 'files' ? null : <section className="workspace">
        <aside className="library">
          <div className="library-title"><h2>Your agreements</h2><span className="count">{agreements.length}</span></div>
          <label className="search"><Search size={15} /><input aria-label="Search agreements" placeholder="Find an agreement..." value={search} onChange={e => setSearch(e.target.value)} /></label>
          <button className={`upload-zone ${dragging ? 'dragging' : ''}`} disabled={busy || loading} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) guard(() => void upload(file)); }}><span className="upload-icon"><Upload size={20} /></span><strong>Drop your PDF here</strong><span>or click to browse</span><small>PDF up to 20 MB · 100 pages</small></button>
          <div className="library-list" aria-label="Agreement library">{loading ? <p className="muted loading"><Loader2 className="spin" size={16} />Loading agreements...</p> : filtered.length ? filtered.map(a => <button key={a.id} className={`agreement-item ${active?.id === a.id ? 'active' : ''}`} disabled={busy} onClick={() => a.id !== active?.id && guard(() => select(a))}><span className="file-icon"><FileText size={20} /></span><span><strong>{a.name}</strong><small><span>{a.page_count} {a.page_count === 1 ? 'page' : 'pages'}</span><span>{a.marks.some(isSignatureMark) ? 'Ready to send' : 'No signature box yet'}</span></small></span>{a.marks.some(isSignatureMark) && <CheckCircle2 className="prepared" size={14} />}</button>) : <p className="library-empty">{search ? 'No matching agreements.' : 'Your templates will appear here.'}</p>}</div>
          <div className="library-tip"><p>No document handy? Try the editor on a sample.</p><button className="text-button" disabled={busy || loading} onClick={() => guard(() => void sample())}>Try a sample agreement</button></div>
        </aside>
        <div className="editor-panel">
          {active ? <><div className="editor-heading"><div>{renaming !== null ? <input className="rename-input" aria-label="Agreement name" autoFocus value={renaming} maxLength={200} onChange={e => setRenaming(e.target.value)} onFocus={e => e.target.select()} onBlur={() => { if (cancelRename.current) cancelRename.current = false; else void rename(); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === 'Escape') { e.preventDefault(); cancelRename.current = true; setRenaming(null); } }} /> : <div className="agreement-title"><h2>{active.name}</h2><button className="icon-button" aria-label="Rename agreement" title="Rename agreement" disabled={busy} onClick={() => setRenaming(active.name)}><Pencil size={15} /></button></div>}<div className="editor-meta"><span>{active.page_count} pages</span><span>{signatureCount} signature {signatureCount === 1 ? 'field' : 'fields'}</span><span className={`save-status ${dirty ? 'unsaved' : ''}`} role="status">{dirty ? <span className="status-dot" /> : <Check size={13} />}{dirty ? 'Unsaved changes' : 'All changes saved'}</span></div></div><div className="editor-actions"><button className="delete-agreement" disabled={busy} onClick={() => { setDeleteError(''); setError(''); setDeleteTarget(active); }}><Trash2 size={15} />Delete agreement</button><button className="primary save" disabled={busy || !dirty} onClick={() => void save()}>{busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Save template</button></div></div><PdfEditor key={active.id} agreement={active} marks={marks} onChange={setMarks} disabled={busy} signerName={account.user.name} /></> : <div className="empty-state"><div className="empty-illustration"><div className="paper back" /><div className="paper front"><FileText size={28} strokeWidth={1.4} /><i /><i /><i /><div className="illustration-signature">Your signature</div></div><span className="floating-check"><Check size={20} /></span></div><h2>Your first agreement starts here</h2><p>Upload a PDF, mark where your client should sign,<br />and save it as a template you can use again.</p><button className="primary" disabled={busy || loading} onClick={() => input.current?.click()}><Upload size={16} />Upload your first PDF</button><button className="text-button" disabled={busy || loading} onClick={() => void sample()}>Or explore a sample agreement</button><div className="empty-steps"><span><span>1</span>Upload PDF</span><span><span>2</span>Place signatures</span><span><span>3</span>Save template</span></div></div>}
        </div>
      </section>}
    </main>
    {confirm && <dialog ref={dialog} open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined} onCancel={e => { e.preventDefault(); setConfirm(false); }} aria-labelledby="discard-title"><h2 id="discard-title">Unsaved changes</h2><p>Your signature fields have changed. Keep editing to save them, or discard these changes and continue.</p><div className="dialog-actions"><button autoFocus className="secondary" onClick={() => setConfirm(false)}>Keep editing</button><button className="primary" onClick={() => { setConfirm(false); pending.current(); }}>Discard changes</button></div></dialog>}
    {deleteTarget && <dialog ref={deleteDialog} open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined} onCancel={e => { e.preventDefault(); if (!busy) setDeleteTarget(null); }} aria-labelledby="delete-title" aria-describedby="delete-description">
      <h2 id="delete-title">Delete agreement?</h2>
      <p id="delete-description">Permanently delete <strong>{deleteTarget.name}</strong>, its PDF, and all signature boxes? This cannot be undone.</p>
      {dirty && active?.id === deleteTarget.id && <p className="delete-unsaved">Your unsaved changes will also be deleted.</p>}
      {deleteError && <p className="delete-error" role="alert">{deleteError}</p>}
      <div className="dialog-actions"><button autoFocus className="secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="danger" disabled={busy} onClick={() => void deleteAgreement()}>{busy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}Delete permanently</button></div>
    </dialog>}
  </div>;
}
