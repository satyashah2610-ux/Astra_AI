import { request, type Agreement } from './api';
import { isSignatureMark } from './items';

export type FileStatus = 'draft' | 'sent' | 'viewed' | 'signed';
export type FileItem = {
  id: string; title: string; client_name: string; signer_name: string; signer_email: string; agreement_id: string; message: string | null; status: FileStatus;
  document_name: string | null; document_sha256: string | null; page_count: number | null; version: number;
  created_at: string; updated_at: string; sent_at: string | null; viewed_at: string | null; signed_at: string | null; field_count: number;
};
export type FileValues = Pick<FileItem, 'title' | 'client_name' | 'signer_name' | 'signer_email' | 'agreement_id'> & { message: string };
export type FileEvent = { type: keyof typeof EVENT_LABELS; at: string; ip: string | null; user_agent: string | null; detail: string | null };
/** What happened to the signing email: queued, turned off by staff, email isn't set up, or the company's daily limit is used up. */
export type EmailResult = 'sending' | 'off' | 'not_configured' | 'limit_reached';
export type SentFile = { file: FileItem; signing_path: string; email: EmailResult };
export type FieldErrors = Partial<Record<keyof FileValues, string>>;

export const STATUS_LABELS: Record<FileStatus, string> = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed' };
export const EVENT_LABELS = { created: 'Created', sent: 'Sent', link_reissued: 'Link reissued', viewed: 'Opened by signer', signed: 'Signed', email_sent: 'Email sent', email_failed: 'Email not delivered' } as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_TEXT = 200;
export const MAX_MESSAGE = 2000;
const json = { 'Content-Type': 'application/json' };
const path = (id: string) => `/api/files/${encodeURIComponent(id)}`;

/** The full link to give the signer: this app's address plus the `/sign#<secret>` path from the server. */
export function signingUrl(origin: string, signingPath: string): string {
  return origin.replace(/\/+$/, '') + signingPath;
}

/** An agreement can be sent only once it has at least one signature box. */
export function sendable(agreement: Agreement): boolean {
  return agreement.marks.some(isSignatureMark);
}

/** Values as they should be stored: text trimmed. */
export function cleanFileValues(values: FileValues): FileValues {
  return { title: values.title.trim(), client_name: values.client_name.trim(), signer_name: values.signer_name.trim(), signer_email: values.signer_email.trim(), agreement_id: values.agreement_id, message: values.message.trim() };
}

/** The same rules the server applies, checked first so staff get instant, specific messages. */
export function validateFile(values: FileValues, agreements: Agreement[]): FieldErrors {
  const v = cleanFileValues(values);
  const errors: FieldErrors = {};
  const text = (key: 'title' | 'client_name' | 'signer_name', missing: string) => {
    if (!v[key]) errors[key] = missing;
    else if (v[key].length > MAX_TEXT) errors[key] = `Use ${MAX_TEXT} characters or fewer.`;
  };
  text('title', 'Enter a file name or reference.');
  text('client_name', 'Enter the client’s name.');
  text('signer_name', 'Enter the name of the person who will sign.');
  if (!EMAIL.test(v.signer_email) || v.signer_email.length > 254) errors.signer_email = 'Enter a valid email address.';
  if (v.message.length > MAX_MESSAGE) errors.message = `Use ${MAX_MESSAGE.toLocaleString('en-US')} characters or fewer.`;
  const agreement = agreements.find(a => a.id === v.agreement_id);
  if (!agreement) errors.agreement_id = 'Choose an agreement.';
  else if (!sendable(agreement)) errors.agreement_id = 'This agreement has no signature boxes yet. Add one in Agreements first.';
  return errors;
}

export const fileApi = {
  list: () => request<FileItem[]>('/api/files'),
  create: (values: FileValues) => request<FileItem>('/api/files', { method: 'POST', headers: json, body: JSON.stringify(cleanFileValues(values)) }),
  update: (id: string, version: number, changes: Partial<FileValues>) => request<FileItem>(path(id), { method: 'PATCH', headers: json, body: JSON.stringify({ version, ...changes }) }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  send: (id: string, email: boolean) => request<SentFile>(`${path(id)}/send`, { method: 'POST', headers: json, body: JSON.stringify({ email }) }),
  reissue: (id: string, email: boolean) => request<SentFile>(`${path(id)}/link`, { method: 'POST', headers: json, body: JSON.stringify({ email }) }),
  events: (id: string) => request<FileEvent[]>(`${path(id)}/events`),
  signedPdfUrl: (id: string) => `${path(id)}/signed.pdf`,
};
