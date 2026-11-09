import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, FileSignature, Link2, Loader2, Pencil, Plus, RefreshCw, RotateCcw, Search, Send, Trash2, X } from 'lucide-react';
import type { Agreement } from './api';
import FileForm, { type FormAction } from './FileForm';
import { EVENT_LABELS, fileApi, signingUrl, STATUS_LABELS, type FileEvent, type FileItem, type FileStatus, type FileValues } from './files';

type Mode = 'view' | 'create' | 'edit';
type Confirm = null | 'reissue' | 'delete';
const FILTERS: ('all' | FileStatus)[] = ['all', 'draft', 'sent', 'viewed', 'signed'];
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** The Files tab: one file per job; create, send, track and collect the signed agreement. */
export default function FilesPage({ agreements }: { agreements: Agreement[] }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | FileStatus>('all');
  const [events, setEvents] = useState<FileEvent[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const changes = useRef(0);  // bumped by every local change; a refresh that started before one is stale
  const filesRef = useRef(files);
  filesRef.current = files;
  const selected = files.find(file => file.id === selectedId) ?? null;

  const load = useCallback(async () => {
    const started = changes.current;
    try {
      const list = await fileApi.list();
      if (changes.current !== started) return;  // something changed here meanwhile; this answer is older than what we show
      // Belt and braces: never replace a newer copy of a file with an older one.
      setFiles(current => list.map(file => { const mine = current.find(f => f.id === file.id); return mine && mine.version > file.version ? mine : file; }));
      setSelectedId(current => current && list.some(file => file.id === current) ? current : list[0]?.id ?? null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {  // a signer works in another browser: catch up whenever staff come back to this window
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);
  useEffect(() => {
    if (!selected) { setEvents([]); return; }
    let live = true;
    fileApi.events(selected.id).then(list => { if (live) setEvents(list); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [selected?.id, selected?.version, selected?.status]);
  useEffect(() => { if (confirm) confirmDialog.current?.showModal?.(); }, [confirm]);
  useEffect(() => { setCopied(false); setMode(current => current === 'edit' ? 'view' : current); }, [selectedId]);

  function replace(file: FileItem) { changes.current += 1; setFiles(current => current.some(f => f.id === file.id) ? current.map(f => f.id === file.id ? file : f) : [file, ...current]); }
  function remember(file: FileItem, path: string) { replace(file); setLinks(current => ({ ...current, [file.id]: signingUrl(window.location.origin, path) })); setCopied(false); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const submit = (values: FileValues, action: FormAction) => run(async () => {
    if (action === 'save' && selected) { replace(await fileApi.update(selected.id, selected.version, values)); setMode('view'); return; }
    const created = await fileApi.create(values);
    replace(created); setSelectedId(created.id); setMode('view');
    if (action === 'send') { const sent = await fileApi.send(created.id); remember(sent.file, sent.signing_path); }
  });
  const send = () => selected && run(async () => { const sent = await fileApi.send(selected.id); remember(sent.file, sent.signing_path); });
  const reissue = () => selected && run(async () => { setConfirm(null); const sent = await fileApi.reissue(selected.id); remember(sent.file, sent.signing_path); });
  const remove = () => selected && run(async () => {
    const id = selected.id;
    try { await fileApi.remove(id); }
    catch (e) { setConfirm(null); throw e; }  // close the modal so the error banner behind it is visible
    setConfirm(null);
    changes.current += 1;
    setFiles(current => current.filter(f => f.id !== id));
    setSelectedId(filesRef.current.find(f => f.id !== id)?.id ?? null);
  });
  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { (document.getElementById('signing-link') as HTMLInputElement | null)?.select(); setError('Copying is blocked by the browser. The link is selected: press Ctrl+C (or ⌘C) to copy it.'); }
  }

  const query = search.trim().toLowerCase();
  const visible = files.filter(file => (filter === 'all' || file.status === filter)
    && (!query || [file.title, file.client_name, file.signer_name, file.signer_email].some(value => value.toLowerCase().includes(query))));
  const agreementName = (file: FileItem) => file.document_name ?? agreements.find(a => a.id === file.agreement_id)?.name ?? 'Agreement removed';
  const link = selected ? links[selected.id] : undefined;
  const startCreate = () => { setError(''); setMode('create'); };

  return <section className="files-page">
    <div className="files-toolbar">
      <button className="primary" disabled={busy} onClick={startCreate}><Plus size={17} />New file</button>
      <button className="secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />Refresh</button>
    </div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><div><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div></div>}
    <div className="workspace files-workspace">
      <aside className="library">
        <div className="library-title"><h2>Files</h2><span className="count">{files.length}</span></div>
        <label className="search"><Search size={15} /><input aria-label="Search files" placeholder="Find a file, client or signer..." value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="status-filters" role="group" aria-label="Filter by status">{FILTERS.map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : STATUS_LABELS[value]}</button>)}</div>
        {loading ? <p className="muted loading"><Loader2 className="spin" size={16} />Loading files...</p>
          : <ul className="file-list" aria-label="Files">{visible.map(file => <li key={file.id}>
            <button className={`file-item ${file.id === selectedId ? 'active' : ''}`} disabled={busy} onClick={() => { setSelectedId(file.id); setMode('view'); setError(''); }}>
              <span className="file-item-text"><strong>{file.title}</strong><small>{file.client_name}</small></span>
              <span className={`status-badge ${file.status}`}>{STATUS_LABELS[file.status]}</span>
            </button></li>)}</ul>}
        {!loading && files.length > 0 && visible.length === 0 && <p className="library-empty">No matching files.</p>}
      </aside>

      <div className="file-detail">
        {mode !== 'view' ? <FileForm key={mode === 'edit' ? `edit-${selected?.id}` : 'create'} agreements={agreements} mode={mode === 'edit' ? 'edit' : 'create'} busy={busy} onSubmit={(values, action) => void submit(values, action)} onCancel={() => setMode('view')}
          initial={mode === 'edit' && selected ? { title: selected.title, client_name: selected.client_name, signer_name: selected.signer_name, signer_email: selected.signer_email, agreement_id: selected.agreement_id } : undefined} />
        : !selected ? <div className="empty-state files-empty"><span className="large-icon"><FileSignature size={30} /></span><span className="tag">ONE FILE PER JOB</span><h2>No files yet</h2>
            <p>Create a file for each new job. Astra Sign sends the client your agreement<br />and keeps the signed copy with the file.</p>
            <button className="primary" onClick={startCreate}><Plus size={16} />New file</button></div>
        : <article className="file-card">
          <header className="file-card-header">
            <div><div className="tiny-eyebrow">FILE</div><h2>{selected.title}</h2></div>
            <span className={`status-badge large ${selected.status}`} data-testid="file-status">{STATUS_LABELS[selected.status]}</span>
          </header>
          <dl className="file-facts">
            <div><dt>Client</dt><dd><span>{selected.client_name}</span></dd></div>
            <div><dt>Signer</dt><dd><span>{selected.signer_name}</span><span className="muted">{selected.signer_email}</span></dd></div>
            <div><dt>Agreement</dt><dd><span>{agreementName(selected)}</span>{selected.field_count > 0 && <span className="muted">{selected.field_count} signature {selected.field_count === 1 ? 'box' : 'boxes'}</span>}</dd></div>
            {selected.sent_at && <div><dt>Sent</dt><dd><span>{when(selected.sent_at)}</span></dd></div>}
            {selected.signed_at && <div><dt>Signed</dt><dd><span>{when(selected.signed_at)}</span></dd></div>}
          </dl>

          <div className="file-actions">
            {selected.status === 'draft' && <>
              <button className="primary" disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Send for signature</button>
              <button className="secondary" disabled={busy} onClick={() => { setError(''); setMode('edit'); }}><Pencil size={15} />Edit</button></>}
            {(selected.status === 'sent' || selected.status === 'viewed') && <button className="secondary" disabled={busy} onClick={() => setConfirm('reissue')}><RotateCcw size={15} />Reissue link</button>}
            {selected.status === 'signed' && <a className="primary" href={fileApi.signedPdfUrl(selected.id)} download><Download size={15} />Download signed PDF</a>}
            {selected.status !== 'signed' && <button className="delete-agreement" disabled={busy} onClick={() => setConfirm('delete')}><Trash2 size={15} />Delete file</button>}
          </div>

          {link && selected.status !== 'signed' && <div className="link-panel">
            <label htmlFor="signing-link"><Link2 size={14} />Signing link</label>
            <div className="link-row"><input id="signing-link" readOnly value={link} onFocus={e => e.target.select()} />
              <button className="primary" onClick={() => void copy(link)}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy link'}</button></div>
            <p>Send this link to {selected.signer_name} by email or message. It is shown only now; if it gets lost, reissue a new link.</p>
          </div>}
          {!link && (selected.status === 'sent' || selected.status === 'viewed') && <p className="muted link-hint">Waiting for {selected.signer_name} to sign. Lost the link? Reissue a new one.</p>}

          <section className="timeline-section"><h3>Timeline</h3>
            <ol className="timeline" aria-label="Timeline">{events.map((event, index) => <li key={index} className={event.type}>
              <strong>{EVENT_LABELS[event.type] ?? event.type}</strong><span>{when(event.at)}</span>{event.ip && <span className="muted">IP {event.ip}</span>}
            </li>)}</ol>
          </section>
        </article>}
      </div>
    </div>

    {confirm && selected && <dialog ref={confirmDialog} open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined} onCancel={e => { e.preventDefault(); if (!busy) setConfirm(null); }} aria-labelledby="file-confirm-title">
      {confirm === 'reissue'
        ? <><h2 id="file-confirm-title">Make a new signing link?</h2><p>The link already sent to {selected.signer_name} will stop working. You will need to send them the new one.</p></>
        : <><h2 id="file-confirm-title">Delete file?</h2><p>Permanently delete <strong>{selected.title}</strong>{selected.status !== 'draft' ? ' and stop its signing link from working' : ''}? This cannot be undone.</p></>}
      <div className="dialog-actions">
        <button autoFocus className="secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
        {confirm === 'reissue'
          ? <button className="primary" disabled={busy} onClick={() => void reissue()}>{busy ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}Make a new link</button>
          : <button className="danger" disabled={busy} onClick={() => void remove()}>{busy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}Delete permanently</button>}
      </div>
    </dialog>}
  </section>;
}
