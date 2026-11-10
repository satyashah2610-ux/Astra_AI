import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SigningPage from './SigningPage';
import Root from './Root';
import { pointerCapture, TestPointerEvent } from './test-utils';
import { fireEvent } from '@testing-library/react';
import { blobText } from './test-utils';

vi.mock('./PdfPages', () => ({ default: ({ marks, comments = [], renderOverlay }: any) => <div>
  <div>PDF with {marks.length} signature box</div>
  {comments.map((c: any) => <p key={c.id}>Note: {c.text}</p>)}
  <div>{renderOverlay?.(1, { width: 600, height: 776, points: 612 })}</div>
</div> }));
vi.mock('./SignaturePad', () => ({
  default: ({ onChange, label }: any) => <div>
    <button onClick={() => onChange({ method: 'drawn', image: `data:image/png;base64,${(label ?? 'signature').toUpperCase()}` })}>Provide {label ?? 'signature'}</button>
    <button onClick={() => onChange(null)}>Clear {label ?? 'signature'}</button>
  </div>,
}));
vi.mock('./StaffGate', () => ({ default: () => <div>Staff workspace</div> }));

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';
const consent = 'I agree to sign this agreement electronically.';
const view = { comments: [{ id: 'c1', page: 1, x: .5, y: .1, width: .2, height: .05, text: 'Tick your payment plan' }], document_name: 'MIND client agreement', signer_name: 'Jordan Smith', page_count: 2, marks: [{ id: 'm1', page: 2, x: .1, y: .6, width: .3, height: .08 }], status: 'sent', sent_at: '2026-11-09T10:00:00Z', signed_at: null, consent_text: consent };
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
  expect(screen.getByText('Hi Jordan Smith, please read the agreement and sign below. Your signature will be placed in the highlighted box.')).toBeInTheDocument();
  expect(screen.getByText('PDF with 1 signature box')).toBeInTheDocument();
  expect(screen.getByLabelText(consent)).not.toBeChecked();
  await waitFor(() => expect(calls.filter(call => call.url === '/api/signing/view')).toHaveLength(1));
  expect(calls.every(call => call.token === token && !call.url.includes(token))).toBe(true);
});

it('tells the signer what is recorded before they agree', async () => {
  render(<SigningPage token={token} />);
  const notice = 'Your IP address, browser and signing time are recorded as part of the signing record.';
  expect(await screen.findByText(notice)).toBeVisible();
  expect(screen.getByLabelText(consent)).toHaveAccessibleDescription(notice);
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
  expect(submitted.body).toEqual({ name: 'Jordan Smith', method: 'drawn', image: 'data:image/png;base64,SIGNATURE', consent: true, items: [], utc_offset_minutes: -new Date().getTimezoneOffset() });
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
  expect(await screen.findByText('Staff workspace')).toBeInTheDocument();
  expect(calls.some(call => call.url.startsWith('/api/auth'))).toBe(false);  // the signing page never checks a login
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

// --- items the signer places ------------------------------------------------------------------------
function pointerSetup() {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  Object.assign(HTMLElement.prototype, pointerCapture);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 600, height: 776, right: 600, bottom: 776, x: 0, y: 0, toJSON() {} } as DOMRect);
}
const layer = () => screen.getByTestId('signer-layer-1');
const tap = (x: number, y: number) => { fireEvent.pointerDown(layer(), { button: 0, pointerId: 1, clientX: x, clientY: y }); fireEvent.pointerUp(layer(), { button: 0, pointerId: 1, clientX: x, clientY: y }); };
async function ready() {
  await userEvent.click(await screen.findByRole('button', { name: 'Provide signature' }));
  await userEvent.click(screen.getByLabelText(consent));
}

it('shows the company’s comments to the signer', async () => {
  render(<SigningPage token={token} />);
  expect(await screen.findByText('Note: Tick your payment plan')).toBeInTheDocument();
});

it('places a tick where the signer taps, then switches the tool off', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  const tool = await screen.findByRole('button', { name: 'Tick', pressed: false });
  tap(300, 388);
  expect(screen.queryByRole('button', { name: 'Tick on page 1' })).not.toBeInTheDocument();  // no tool chosen: tapping does nothing
  await userEvent.click(tool);
  expect(screen.getByRole('button', { name: 'Tick', pressed: true })).toBeInTheDocument();
  tap(300, 388);
  const tick = screen.getByRole('button', { name: 'Tick on page 1' });
  const box = { x: parseFloat(tick.style.left) / 100, width: parseFloat(tick.style.width) / 100 };
  expect(box.x + box.width / 2).toBeCloseTo(.5);
  expect(screen.getByRole('button', { name: 'Tick', pressed: false })).toBeInTheDocument();
});

it('moves an item by dragging and removes it', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Dot' }));
  tap(300, 388);
  const dot = screen.getByRole('button', { name: 'Dot on page 1' });
  const before = parseFloat(dot.style.left);
  fireEvent.pointerDown(dot, { button: 0, pointerId: 2, clientX: 300, clientY: 388 });
  fireEvent.pointerMove(layer(), { button: 0, pointerId: 2, clientX: 360, clientY: 388 });
  fireEvent.pointerUp(layer(), { button: 0, pointerId: 2, clientX: 360, clientY: 388 });
  expect(parseFloat(screen.getByRole('button', { name: 'Dot on page 1' }).style.left)).toBeCloseTo(before + 10);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Dot' }));
  expect(screen.queryByRole('button', { name: 'Dot on page 1' })).not.toBeInTheDocument();
});

it('needs placed text boxes filled in before signing', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  await ready();
  expect(signButton()).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Text' }));
  tap(200, 300);
  const input = screen.getByLabelText('Text on page 1');
  expect(input).toHaveFocus();
  expect(signButton()).toBeDisabled();
  expect(screen.getByText(/type something in each text box/i)).toBeInTheDocument();
  await userEvent.type(input, 'Unit 4B');
  expect(signButton()).toBeEnabled();
});

it('shows the signer’s name and today’s date in Name and Date items', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  await screen.findByLabelText('Full name');
  await userEvent.click(screen.getByRole('button', { name: 'Name' }));
  tap(200, 500);
  await userEvent.click(screen.getByRole('button', { name: 'Date' }));
  tap(400, 500);
  expect(screen.getByRole('button', { name: 'Name on page 1' })).toHaveTextContent('Jordan Smith');
  const today = new Date();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][today.getMonth()];
  expect(screen.getByRole('button', { name: 'Date on page 1' })).toHaveTextContent(`${String(today.getDate()).padStart(2, '0')} ${month} ${today.getFullYear()}`);
});

it('asks for initials only once an initials item is placed', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  await ready();
  expect(screen.queryByRole('button', { name: 'Provide initials' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Initials' }));
  tap(500, 700);
  expect(signButton()).toBeDisabled();
  expect(screen.getByText(/adopt your initials/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Provide initials' }));
  expect(signButton()).toBeEnabled();
});

it('sends every placed item, the initials and the time zone with the signature', async () => {
  pointerSetup();
  render(<SigningPage token={token} />);
  await ready();
  for (const [tool, x, y] of [['Tick', 100, 100], ['Dot', 100, 200], ['Text', 300, 300], ['Name', 300, 400], ['Date', 300, 450], ['Initials', 500, 700], ['Signature', 300, 600]] as const) {
    await userEvent.click(screen.getByRole('button', { name: tool }));
    tap(x, y);
  }
  await userEvent.type(screen.getByLabelText('Text on page 1'), '  Unit 4B  ');
  await userEvent.click(screen.getByRole('button', { name: 'Provide initials' }));
  await userEvent.click(signButton());
  await screen.findByRole('heading', { name: /You’ve signed/ });
  const body = calls.find(call => call.url === '/api/signing/sign')!.body;
  expect(body.items.map((item: any) => item.type)).toEqual(['check', 'dot', 'text', 'name', 'date', 'initials', 'signature']);
  for (const item of body.items) {
    expect(item).toMatchObject({ page: 1, id: expect.any(String), x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
    if (item.type === 'text') expect(item.text).toBe('Unit 4B');
    else expect(item).not.toHaveProperty('text');  // name and date are filled by the server
  }
  expect(body.initials).toEqual({ method: 'drawn', image: 'data:image/png;base64,INITIALS' });
  expect(body.utc_offset_minutes).toBe(-new Date().getTimezoneOffset());
});

it('says "the highlighted boxes" when there is more than one signature box', async () => {
  state = { ...view, marks: [...view.marks, { id: 'm2', page: 2, x: .1, y: .8, width: .3, height: .08 }] };
  render(<SigningPage token={token} />);
  expect(await screen.findByText('Hi Jordan Smith, please read the agreement and sign below. Your signature will be placed in the highlighted boxes.')).toBeInTheDocument();
});
