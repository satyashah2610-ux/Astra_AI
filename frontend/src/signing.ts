import { request, requestFile, type Mark } from './api';
import type { Comment } from './PdfPages';
import type { SignerItem } from './items';

export type SigningStatus = 'sent' | 'viewed' | 'signed';
export type SigningView = {
  document_name: string; signer_name: string; page_count: number; marks: Mark[]; comments?: Comment[];
  status: SigningStatus; sent_at: string; signed_at: string | null; consent_text: string;
};
export type Signature = { method: 'typed' | 'drawn'; image: string };
export type Submission = Signature & { name: string; consent: true; items?: SignerItem[]; initials?: Signature; utc_offset_minutes?: number };

const SIGN_PATH = /^\/sign\/?$/;
const TOKEN = /^#([A-Za-z0-9_-]{20,})$/;

/**
 * The link secret from a `/sign#<token>` page URL, or null for any other location.
 * The secret lives in the fragment because browsers never send fragments to a server or in a Referer,
 * so it cannot end up in web-server, proxy or CDN logs.
 */
export function tokenFromLocation(path: string, hash: string): string | null {
  return SIGN_PATH.test(path) ? TOKEN.exec(hash)?.[1] ?? null : null;
}

/** Signing API client. The secret goes in a header so it never appears in server access logs. */
export function signingApi(token: string) {
  const headers = { 'X-Signing-Token': token };
  return {
    load: () => request<SigningView>('/api/signing', { headers }),
    markViewed: () => request<SigningView>('/api/signing/view', { method: 'POST', headers }),
    submit: (body: Submission) => request<SigningView>('/api/signing/sign', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    downloadSigned: () => requestFile('/api/signing/signed.pdf', { headers }),
    pdf: { url: '/api/signing/pdf', httpHeaders: headers },
  };
}
