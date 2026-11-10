import { useEffect, useState, type FormEvent } from 'react';
import { Loader2, Save, Send } from 'lucide-react';
import type { Agreement } from './api';
import { cleanFileValues, MAX_MESSAGE, sendable, validateFile, type FieldErrors, type FileValues } from './files';

export type FormAction = 'send' | 'draft' | 'save';
type Props = {
  agreements: Agreement[];
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
export default function FileForm({ agreements, initial, mode, busy, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<FileValues>(initial ?? { ...EMPTY, agreement_id: agreements.find(sendable)?.id ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [emailLink, setEmailLink] = useState(true);
  const anySendable = agreements.some(sendable);
  const firstReady = agreements.find(sendable)?.id;

  useEffect(() => {  // agreements can arrive after the form opens: pick the first ready one if none is chosen
    if (mode === 'create' && firstReady) setValues(current => current.agreement_id ? current : { ...current, agreement_id: firstReady });
  }, [mode, firstReady]);

  function submit(action: FormAction, event?: FormEvent) {
    event?.preventDefault();
    const found = validateFile(values, agreements);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(cleanFileValues(values), action, emailLink);
  }
  const set = (key: keyof FileValues, value: string) => { setValues(current => ({ ...current, [key]: value })); setErrors(current => ({ ...current, [key]: undefined })); };

  return <form className="file-form" noValidate onSubmit={event => submit(mode === 'create' ? 'send' : 'save', event)} aria-labelledby="file-form-title">
    <h2 id="file-form-title">{mode === 'create' ? 'New file' : 'Edit file'}</h2>
    {!anySendable && <p className="form-note">Prepare an agreement with at least one signature box in <strong>Agreements</strong> first.</p>}
    {FIELDS.map(field => {
      const id = `file-${field.key}`;
      const described = errors[field.key] ? `${id}-error` : field.hint ? `${id}-hint` : undefined;
      return <div key={field.key} className={`form-field ${errors[field.key] ? 'invalid' : ''}`}>
        <label htmlFor={id}>{field.label}</label>
        <input id={id} type={field.type ?? 'text'} value={values[field.key]} maxLength={field.key === 'signer_email' ? 254 : 200} autoComplete={field.autoComplete ?? 'off'} disabled={busy}
          aria-invalid={Boolean(errors[field.key])} aria-describedby={described} onChange={e => set(field.key, e.target.value)} />
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
    {mode === 'create' && emailLink && <small className="field-hint check-hint">If it isn’t signed, they get a reminder every day until it is.</small>}
    <div className="form-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      {mode === 'create'
        ? <><button type="button" className="secondary" disabled={busy} onClick={() => submit('draft')}><Save size={15} />Save as draft</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Create and send</button></>
        : <button type="submit" className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Save size={15} />}Save changes</button>}
    </div>
  </form>;
}
