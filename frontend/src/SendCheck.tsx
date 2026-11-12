import { useEffect, useRef } from 'react';
import { Loader2, Send } from 'lucide-react';
import type { FileValues } from './files';

type Props = { values: FileValues; agreementName: string; emailLink: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void };

/** The last check before a file goes to the client: every detail staff entered, then send or go back. */
export default function SendCheck({ values, agreementName, emailLink, busy, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal?.(); }, []);
  const rows: [string, string][] = [
    ['File name or reference', values.title], ['Client', values.client_name], ['Signer', values.signer_name], ['Signer email', values.signer_email],
    ['Agreement', agreementName], ...(values.message.trim() ? [['Personal message', values.message.trim()] as [string, string]] : []),
    ['Email the link', emailLink ? 'Yes, with a daily reminder for up to 7 days' : 'No, you will share the link yourself'],
  ];
  return <dialog ref={dialog} className="send-check" open={typeof HTMLDialogElement.prototype.showModal !== 'function' ? true : undefined}
    onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="send-check-title">
    <h2 id="send-check-title">Check the details before sending</h2>
    <p>The agreement goes to the signer as shown below.</p>
    <dl className="send-check-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="dialog-actions">
      <button type="button" autoFocus className="secondary" disabled={busy} onClick={onCancel}>Go back and edit</button>
      <button type="button" className="primary" disabled={busy} onClick={onConfirm}>{busy ? <Loader2 className="spin" size={15} /> : <Send size={15} />}Confirm and send</button>
    </div>
  </dialog>;
}
