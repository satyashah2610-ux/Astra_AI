import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Loader2, Save, Send } from 'lucide-react';
import type { Agreement } from './api';
import SendCheck from './SendCheck';
import { cleanFileValues, matchSigners, MAX_MESSAGE, sendable, validateFile, type FieldErrors, type FileValues, type PastSigner } from './files';

export type FormAction = 'send' | 'draft' | 'save';
type Props = {
  agreements: Agreement[];
  pastSigners?: PastSigner[];  // offered while typing the client name of a new file
  initial?: FileValues;
  mode: 'create' | 'edit';
  busy: boolean;
  onSubmit: (values: FileValues, action: FormAction, emailLink: boolean) => void;
  onCancel: () => void;
};

const EMPTY: FileValues = { title: '', client_name: '', signer_name: '', signer_email: '', agreement_id: '', message: '' };
const FIELDS: { key: Exclude<keyof FileValues, 'agreement_id' | 'message'>; label: string; type?: string; autoComplete?: string; hint?: string }[] = [
  { key: 'title', label: 'File name or reference', hint: 'How your team refers to this job, e.g. “Smith – kitchen remodel”.' },
  { key: 'client_name', label: 'Client name', autoComplete: 'organization' },
  { key: 'signer_name', label: 'Signer name', autoComplete: 'name' },
  { key: 'signer_email', label: 'Signer email', type: 'email', autoComplete: 'email' },
];

/** Create or edit a file. Checks the same rules as the server before anything is sent. */
export default function FileForm({ agreements, pastSigners = [], initial, mode, busy, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<FileValues>(initial ?? { ...EMPTY, agreement_id: agreements.find(sendable)?.id ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [emailLink, setEmailLink] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [active, setActive] = useState(-1);
  const [checking, setChecking] = useState(false);  // "Create and send" first shows every detail to check
  const suggestions = useMemo(() => mode === 'create' ? matchSigners(pastSigners, values.client_name) : [], [mode, pastSigners, values.client_name]);
  const listOpen = suggesting && suggestions.length > 0;
  useEffect(() => {  // the arrow keys keep the highlighted line visible in a long list
    if (active >= 0) document.getElementById(`client-suggestion-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  const anySendable = agreements.some(sendable);
  const firstReady = agreements.find(sendable)?.id;

  useEffect(() => {  // agreements can arrive after the form opens: pick the first ready one if none is chosen
    if (mode === 'create' && firstReady) setValues(current => current.agreement_id ? current : { ...current, agreement_id: firstReady });
  }, [mode, firstReady]);

  function submit(action: FormAction, event?: FormEvent) {
    event?.preventDefault();
    const found = validateFile(values, agreements);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (action === 'send') setChecking(true);
    else onSubmit(cleanFileValues(values), action, emailLink);
  }
  const set = (key: keyof FileValues, value: string) => { setValues(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };
  /** Fill the client, signer and email from an earlier file; everything else stays as it is. */
  function choose(signer: PastSigner) {
    setValues(current => ({ ...current, client_name: signer.client_name, signer_name: signer.signer_name, signer_email: signer.signer_email }));
    setErrors(current => ({ ...current, client_name: undefined, signer_name: undefined, signer_email: undefined }));
    setSuggesting(false); setActive(-1);
  }
  function suggestionKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) { if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setSuggesting(true); setActive(0); } return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (event.key === 'Enter') {  // never sends the file
      event.preventDefault();
      const picked = suggestions[active];  // the list may have changed since the line was highlighted
      if (picked) choose(picked); else setSuggesting(false);
    }
    else if (event.key === 'Escape') { event.preventDefault(); setSuggesting(false); setActive(-1); }
  }

  return <form className="file-form" noValidate onSubmit={event => submit(mode === 'create' ? 'send' : 'save', event)} aria-labelledby="file-form-title">
    <h2 id="file-form-title">{mode === 'create' ? 'New file' : 'Edit file'}</h2>
    {!anySendable && <p className="form-note">Prepare an agreement with at least one signature box in <strong>Agreements</strong> first.</p>}
    {FIELDS.map(field => {
      const id = `file-${field.key}`;
      const described = errors[field.key] ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
      const picker = field.key === 'client_name' && mode === 'create';  // earlier clients, offered while typing
      return <div key={field.key} className={`form-field ${errors[field.key] ? 'invalid' : ''} ${picker ? 'with-suggestions' : ''}`}>
        <label htmlFor={id}>{field.label}</label>
        <input id={id} type={field.type ?? 'text'} value={values[field.key]} maxLength={field.key === 'signer_email' ? 254 : 200} autoComplete={picker ? 'off' : (field.autoComplete ?? 'off')} disabled={busy}
          aria-invalid={Boolean(errors[field.key])} aria-describedby={described}
          onChange={e => { set(field.key, e.target.value); if (picker) { setSuggesting(true); setActive(-1); } }}
          {...picker ? { role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': listOpen, 'aria-controls': listOpen ? 'client-suggestions' : undefined,
            'aria-activedescendant': listOpen && active >= 0 ? `client-suggestion-${active}` : undefined,
            onKeyDown: suggestionKeys, onBlur: () => { setSuggesting(false); setActive(-1); } } : {}} />
        {picker && listOpen && <ul id="client-suggestions" className="suggestions" role="listbox" aria-label="Earlier clients"
          onMouseDown={e => e.preventDefault()}>  {/* clicking a line or the scrollbar keeps the box focused, so the list stays open */}
          {suggestions.map((signer, index) => <li key={`${signer.client_name}|${signer.signer_name}|${signer.signer_email}`} id={`client-suggestion-${index}`} role="option"
            aria-selected={index === active} className={index === active ? 'active' : ''}
            onMouseDown={e => e.preventDefault()} onClick={() => choose(signer)}>
            <strong>{signer.client_name}</strong><span>{signer.signer_name}</span><span>{signer.signer_email}</span>
          </li>)}
        </ul>}
        {errors[field.key] ? <small className="field-error" id={`${id}-error`}>{errors[field.key]}</small>
          : field.hint && <small className="field-hint" id={`${id}-hint`}>{field.hint}</small>}
      </div>;
    })}
    <div className={`form-field ${errors.agreement_id ? 'invalid' : ''}`}>
      <label htmlFor="file-agreement_id">Agreement</label>
      <select id="file-agreement_id" value={values.agreement_id} disabled={busy} aria-invalid={Boolean(errors.agreement_id)} aria-describedby={errors.agreement_id ? 'file-agreement_id-error' : undefined} onChange={e => set('agreement_id', e.target.value)}>
        <option value="">Choose an agreement</option>
        {agreements.map(a => <option key={a.id} value={a.id} disabled={!sendable(a)}>{a.name}{sendable(a) ? '' : ' (add signature boxes first)'}</option>)}
      </select>
      {errors.agreement_id && <small className="field-error" id="file-agreement_id-error">{errors.agreement_id}</small>}
    </div>
    <div className={`form-field ${errors.message ? 'invalid' : ''}`}>
      <label htmlFor="file-message">Personal message (optional)</label>
      <textarea id="file-message" rows={4} value={values.message} maxLength={MAX_MESSAGE} disabled={busy} aria-invalid={Boolean(errors.message)}
        aria-describedby={errors.message ? 'file-message-error' : 'file-message-hint'} onChange={e => set('message', e.target.value)} />
      {errors.message ? <small className="field-error" id="file-message-error">{errors.message}</small>
        : <small className="field-hint" id="file-message-hint">Shown in the email to the signer, e.g. “Hi Jordan, here’s the agreement we discussed.”</small>}
    </div>
    {mode === 'create' && <label className="check-row"><input type="checkbox" checked={emailLink} disabled={busy} onChange={e => setEmailLink(e.target.checked)} />Email the link to the signer</label>}
    {mode === 'create' && emailLink && <small className="field-hint check-hint">If it isn’t signed, they get a reminder every day for up to 7 days.</small>}
    <div className="form-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      {mode === 'create'
        ? <><button type="button" className="secondary" disabled={busy} onClick={() => submit('draft')}><Save size={15} />Save as draft</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Create and send</button></>
        : <button type="submit" className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}Save changes</button>}
    </div>
    {checking && <SendCheck values={cleanFileValues(values)} agreementName={agreements.find(a => a.id === values.agreement_id)?.name ?? ''} emailLink={emailLink} busy={busy}
      onCancel={() => setChecking(false)} onConfirm={() => { setChecking(false); onSubmit(cleanFileValues(values), 'send', emailLink); }} />}
  </form>;
}
