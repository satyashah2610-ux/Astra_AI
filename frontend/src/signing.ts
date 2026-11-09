import { request, type Mark } from './api';

export type SigningStatus = 'sent' | 'viewed' | 'signed';
export type SigningView = {
  document_name: string; signer_name: string; page_count: number; marks: Mark[];
  status: SigningStatus; sent_at: string; signed_at: string | null; consent_text: string;
};
export type Signature = { method: 'typed' | 'drawn'; image: string };
export type Submission = Signature & { name: string; consent: true };

const TOKEN_PATH = /^\/sign\/([A-Za-z0-9_-]{20,})\/?$/;

/** The link secret from a `/sign/<token>` page URL, or null for any other path. */
export function tokenFromPath(path: string): string | null {
  return TOKEN_PATH.exec(path)?.[1] ?? null;
}

/** Signing API client. The secret goes in a header so it never appears in server access logs. */
export function signingApi(token: string) {
  const headers = { 'X-Signing-Token': token };
  return {
    load: () => request<SigningView>('/api/signing', { headers }),
    markViewed: () => request<SigningView>('/api/signing/view', { method: 'POST', headers }),
    submit: (body: Submission) => request<SigningView>('/api/signing/sign', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    pdf: { url: '/api/signing/pdf', httpHeaders: headers },
  };
}
