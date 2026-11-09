import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CheckCircle2, Download, FileWarning, Loader2, Lock, Sparkles } from 'lucide-react';
import { saveFile } from './api';
import PdfPages from './PdfPages';
import SignaturePad from './SignaturePad';
import { signingApi, type Signature, type SigningView } from './signing';

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : '';

/** Public page a client opens from their signing link. No account needed. */
export default function SigningPage({ token }: { token: string }) {
  const api = useMemo(() => signingApi(token), [token]);
  const [view, setView] = useState<SigningView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [signature, setSignature] = useState<Signature | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justSigned, setJustSigned] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const viewed = useRef(false);

  useEffect(() => {
    let live = true;
    api.load().then(loaded => {
      if (!live) return;
      setView(loaded); setName(loaded.signer_name);
      document.title = `Sign ${loaded.document_name} — Astra Sign`;
      if (loaded.status !== 'signed' && !viewed.current) {
        viewed.current = true;
        api.markViewed().catch(() => { /* viewing still works; the status update is best effort */ });
      }
    }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : 'This link could not be opened.'); });
    return () => { live = false; };
  }, [api]);

  const ready = Boolean(name.trim() && signature && consent && !busy);
  async function submit() {
    if (!ready || !signature) return;
    setBusy(true); setError('');
    try {
      setView(await api.submit({ name: name.trim(), method: signature.method, image: signature.image, consent: true }));
      setJustSigned(true);
      document.querySelector('.signing-shell')?.scrollIntoView?.({ block: 'start' });
    } catch (e) { setError(e instanceof Error ? e.message : 'Your signature could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!view) return;
    setDownloading(true); setDownloadError('');
    try { saveFile(await api.downloadSigned(), `${view.document_name} - signed.pdf`); }
    catch (e) { setDownloadError(e instanceof Error ? e.message : 'The signed copy could not be downloaded. Try again.'); }
    finally { setDownloading(false); }
  }
  function goToBox() {
    const first = view?.marks[0];
    if (first) document.getElementById(`sign-box-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const header = <header className="signing-top"><span className="brand"><span className="brand-icon"><Sparkles size={20} strokeWidth={1.6} /></span>Astra Sign</span><span className="secure-note"><Lock size={13} />Secure signing link</span></header>;

  if (loadError) return <div className="signing-shell">{header}<main className="signing-message"><FileWarning size={34} /><h1>This link isn’t valid</h1><p>{loadError}</p></main></div>;
  if (!view) return <div className="signing-shell">{header}<main className="signing-message"><Loader2 className="spin" size={28} /><p>Opening your agreement...</p></main></div>;
  if (view.status === 'signed') return <div className="signing-shell">{header}<main className="signing-message done">
    <CheckCircle2 size={38} />
    <h1>{justSigned ? `You’ve signed ${view.document_name}` : 'This agreement is already signed'}</h1>
    <p>Signed on {when(view.signed_at)}.{justSigned ? ' Thank you. The sender has your signed agreement.' : ''}</p>
    <button className="primary" onClick={() => void download()} disabled={downloading}>{downloading ? <Loader2 className="spin" size={15} /> : <Download size={15} />}Download signed copy</button>
    {downloadError && <div className="error-banner" role="alert">{downloadError}</div>}
    <p className="muted">The signed copy includes a certificate page with the signing record. You can close this page.</p>
  </main></div>;

  const boxes = view.marks.length;
  return <div className="signing-shell">{header}
    <main className="signing-layout">
      <section className="signing-document" aria-label="Agreement to sign">
        <PdfPages source={api.pdf} marks={view.marks} pageCount={view.page_count} signature={signature?.image} />
      </section>
      <aside className="signing-panel">
        <div className="eyebrow">SIGNATURE REQUESTED</div>
        <h1>{view.document_name}</h1>
        <p className="signing-intro">Hi {view.signer_name}, please read the agreement and sign below. Your signature will be placed in the {boxes} highlighted {boxes === 1 ? 'box' : 'boxes'}.</p>
        <button className="text-button" onClick={goToBox}><ArrowDown size={14} />Go to signature {boxes === 1 ? 'box' : 'boxes'}</button>
        <div className="field-divider" />
        <label className="form-field"><span>Full name</span><input value={name} onChange={e => setName(e.target.value)} maxLength={200} autoComplete="name" disabled={busy} /></label>
        <SignaturePad name={name} onChange={setSignature} />
        <label className="consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} /><span>{view.consent_text}</span></label>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <button className="primary sign-button" disabled={!ready} onClick={() => void submit()}>{busy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}Sign agreement</button>
      </aside>
    </main>
  </div>;
}
