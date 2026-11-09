import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SigningPage from './SigningPage';
import Root from './Root';
import { blobText } from './test-utils';

vi.mock('./PdfPages', () => ({ default: ({ marks }: any) => <div>PDF with {marks.length} signature box</div> }));
vi.mock('./SignaturePad', () => ({
  default: ({ onChange }: any) => <div>
    <button onClick={() => onChange({ method: 'drawn', image: 'data:image/png;base64,SIGNATURE' })}>Provide signature</button>
    <button onClick={() => onChange(null)}>Clear signature</button>
  </div>,
}));
vi.mock('./App', () => ({ default: () => <div>Staff workspace</div> }));

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
const consent = 'I agree to sign this agreement electronically.';
const view = { document_name: 'MIND client agreement', signer_name: 'Jordan Smith', page_count: 2, marks: [{ id: 'm1', page: 2, x: .1, y: .6, width: .3, height: .08 }], status: 'sent', sent_at: '2026-11-09T10:00:00Z', signed_at: null, consent_text: consent };
let state: any;
let calls: { url: string; method: string; body?: any; token: string | null }[];
let failSign: boolean;
let failDownload: boolean;
let saved: { blob: Blob; filename: string }[];

beforeEach(() => {
  state = { ...view };
  calls = [];
  failSign = false;
  failDownload = false;
  saved = [];
  // Capture what the page saves: the Blob URL and the anchor's download filename.
  const blobs = new Map<string, Blob>();
  // A real URL subclass, so `new URL(...)` still works while object URLs are captured.
  vi.stubGlobal('URL', class extends URL { static createObjectURL(blob: Blob) { const url = `blob:test/${blobs.size}`; blobs.set(url, blob); return url; } static revokeObjectURL() {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push({ blob: blobs.get(this.href)!, filename: this.download }); });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method ?? 'GET';
    calls.push({ url, method, body: options.body ? JSON.parse(options.body as string) : undefined, token: new Headers(options.headers).get('X-Signing-Token') });
    if (state === null) return new Response(JSON.stringify({ detail: 'This signing link is invalid or has been replaced. Ask the sender for a new link.' }), { status: 404 });
    if (url === '/api/signing/signed.pdf') {
      if (failDownload) return new Response(JSON.stringify({ detail: 'The signed PDF could not be created.' }), { status: 503 });
      return new Response('%PDF-signed', { headers: { 'Content-Type': 'application/pdf' } });
    }
    if (url === '/api/signing/view') state = { ...state, status: state.status === 'sent' ? 'viewed' : state.status };
    if (url === '/api/signing/sign') {
      if (failSign) return new Response(JSON.stringify({ detail: 'Could not save your signature. Try again.' }), { status: 503 });
      state = { ...state, status: 'signed', signed_at: '2026-11-09T11:00:00Z' };
    }
    return new Response(JSON.stringify(state));
  }));
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const signButton = () => screen.getByRole('button', { name: 'Sign agreement' });

it('shows a clear message for an invalid or replaced link', async () => {
  state = null;
  render(<SigningPage token={token} />);
  expect(await screen.findByRole('heading', { name: /link isn’t valid/i })).toBeInTheDocument();
  expect(screen.getByText(/Ask the sender for a new link/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign agreement' })).not.toBeInTheDocument();
});

it('loads the document, marks it viewed once and shows the consent wording from the server', async () => {
  render(<SigningPage token={token} />);
  expect(await screen.findByRole('heading', { name: 'MIND client agreement' })).toBeInTheDocument();
  expect(screen.getByText(/Jordan Smith/)).toBeInTheDocument();
  expect(screen.getByText('PDF with 1 signature box')).toBeInTheDocument();
  expect(screen.getByLabelText(consent)).not.toBeChecked();
  await waitFor(() => expect(calls.filter(call => call.url === '/api/signing/view')).toHaveLength(1));
  expect(calls.every(call => call.token === token && !call.url.includes(token))).toBe(true);
});

it('enables signing only with a name, a signature and consent', async () => {
  render(<SigningPage token={token} />);
  const name = await screen.findByLabelText('Full name');
  expect(name).toHaveValue('Jordan Smith');
  expect(signButton()).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Provide signature' }));
  expect(signButton()).toBeDisabled();
  await userEvent.click(screen.getByLabelText(consent));
  expect(signButton()).toBeEnabled();
  await userEvent.clear(name);
  expect(signButton()).toBeDisabled();
  await userEvent.type(name, 'Jordan A. Smith');
  await userEvent.click(screen.getByRole('button', { name: 'Clear signature' }));
  expect(signButton()).toBeDisabled();
});

it('submits the signature and shows the confirmation', async () => {
  render(<SigningPage token={token} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Provide signature' }));
  await userEvent.click(screen.getByLabelText(consent));
  await userEvent.click(signButton());
  expect(await screen.findByRole('heading', { name: /You’ve signed/ })).toBeInTheDocument();
  const submitted = calls.find(call => call.url === '/api/signing/sign')!;
  expect(submitted.body).toEqual({ name: 'Jordan Smith', method: 'drawn', image: 'data:image/png;base64,SIGNATURE', consent: true });
  expect(screen.queryByRole('button', { name: 'Sign agreement' })).not.toBeInTheDocument();
});

it('keeps the form and shows the error when signing fails', async () => {
  failSign = true;
  render(<SigningPage token={token} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Provide signature' }));
  await userEvent.click(screen.getByLabelText(consent));
  await userEvent.click(signButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your signature');
  expect(signButton()).toBeEnabled();
  expect(screen.getByLabelText(consent)).toBeChecked();
});

it('shows the signed state, without a form, for an agreement that is already signed', async () => {
  state = { ...view, status: 'signed', signed_at: '2026-11-09T11:00:00Z' };
  render(<SigningPage token={token} />);
  expect(await screen.findByRole('heading', { name: /already signed/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign agreement' })).not.toBeInTheDocument();
  expect(calls.some(call => call.url === '/api/signing/view')).toBe(false);
});

it('routes signing links to the signing page and everything else to the staff workspace', async () => {
  const signing = render(<Root path="/sign" hash={`#${token}`} />);
  expect(await screen.findByRole('heading', { name: 'MIND client agreement' })).toBeInTheDocument();
  expect(screen.queryByText('Staff workspace')).not.toBeInTheDocument();
  signing.unmount();
  render(<Root path="/" hash="" />);
  expect(screen.getByText('Staff workspace')).toBeInTheDocument();
});

async function signNow() {
  render(<SigningPage token={token} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Provide signature' }));
  await userEvent.click(screen.getByLabelText(consent));
  await userEvent.click(signButton());
  await screen.findByRole('heading', { name: /You’ve signed/ });
}

it('lets the signer download the signed copy right after signing, authenticated by header', async () => {
  await signNow();
  await userEvent.click(screen.getByRole('button', { name: 'Download signed copy' }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0].filename).toBe('MIND client agreement - signed.pdf');
  expect(await blobText(saved[0].blob)).toBe('%PDF-signed');
  const download = calls.find(call => call.url === '/api/signing/signed.pdf')!;
  expect(download.token).toBe(token);
  expect(download.url).not.toContain(token);
});

it('offers the signed copy again when the signer reopens a signed link', async () => {
  state = { ...view, status: 'signed', signed_at: '2026-11-09T11:00:00Z' };
  render(<SigningPage token={token} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Download signed copy' }));
  await waitFor(() => expect(saved).toHaveLength(1));
});

it('explains a failed download and lets the signer try again', async () => {
  failDownload = true;
  await signNow();
  await userEvent.click(screen.getByRole('button', { name: 'Download signed copy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be created');
  expect(saved).toHaveLength(0);
  failDownload = false;
  await userEvent.click(screen.getByRole('button', { name: 'Download signed copy' }));
  await waitFor(() => expect(saved).toHaveLength(1));
});
