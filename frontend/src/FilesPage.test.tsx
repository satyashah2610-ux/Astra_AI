import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import FilesPage from './FilesPage';
import type { Agreement } from './api';
import type { FileItem } from './files';

const mind: Agreement = { id: 'a1', name: 'MIND agreement', filename: 'MIND.pdf', page_count: 2, version: 1, created_at: '', updated_at: '', marks: [{ id: 'm1', page: 2, x: .1, y: .5, width: .3, height: .08 }] };
const blank: Agreement = { ...mind, id: 'a2', name: 'Blank agreement', marks: [] };

// --- an in-memory backend with the same rules as the real one ---------------------------------------
let files: FileItem[];
let events: Record<string, { type: string; at: string; ip: string | null; user_agent: string | null }[]>;
let tokens: number;
let nextId: number;
let failSend: boolean;
let failDelete: boolean;
let holdList: boolean;
let releaseList: (() => void) | null;
let requests: { method: string; url: string; body?: any }[];

function json(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status }); }
function event(id: string, type: string) { (events[id] ??= []).push({ type, at: '2026-11-09T12:00:00+00:00', ip: type === 'viewed' || type === 'signed' ? '203.0.113.7' : null, user_agent: null }); }
function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  nextId += 1;
  return { id: `f${nextId}`, title: 'Smith kitchen', client_name: 'Smith Family', signer_name: 'Jordan Smith', signer_email: 'jordan@example.com', agreement_id: 'a1', status: 'draft',
    document_name: null, document_sha256: null, page_count: null, version: 0, created_at: `2026-11-09T12:${String(nextId).padStart(2, "0")}:00+00:00`, updated_at: '2026-11-09T12:00:00+00:00',
    sent_at: null, viewed_at: null, signed_at: null, field_count: 0, ...overrides };
}

beforeEach(() => {
  files = []; events = {}; tokens = 0; nextId = 0; failSend = false; failDelete = false; holdList = false; releaseList = null; requests = [];
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit = {}) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body as string) : undefined;
    requests.push({ method, url, body });
    const [, id, action] = url.match(/^\/api\/files(?:\/([^/]+))?(?:\/(\w+))?$/) ?? [];
    const file = files.find(f => f.id === id);
    if (url === '/api/files' && method === 'GET') {
      const snapshot = JSON.parse(JSON.stringify([...files].reverse()));  // what the server had when the request arrived
      if (holdList) { holdList = false; return new Promise<Response>(resolve => { releaseList = () => resolve(json(snapshot)); }); }
      return json(snapshot);
    }
    if (url === '/api/files' && method === 'POST') { const created = makeFile(body); files.push(created); event(created.id, 'created'); return json(created, 201); }
    if (!file) return json({ detail: 'File not found.' }, 404);
    if (action === 'events') return json(events[file.id] ?? []);
    if (method === 'PATCH') {
      if (file.version !== body.version) return json({ detail: 'This file was changed in another tab.' }, 409);
      const { version: _v, ...changes } = body;
      Object.assign(file, changes, { version: file.version + 1 });
      return json(file);
    }
    if (method === 'DELETE') { if (failDelete) return json({ detail: 'Could not delete the file. Try again.' }, 503); files = files.filter(f => f !== file); return json(null, 204); }
    if (action === 'send') {
      if (failSend) return json({ detail: 'Could not send. Try again.' }, 503);
      Object.assign(file, { status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1, version: file.version + 1 });
      event(file.id, 'sent');
      return json({ file, signing_path: `/sign#token-${++tokens}` });
    }
    if (action === 'link') { event(file.id, 'link_reissued'); return json({ file, signing_path: `/sign#token-${++tokens}` }); }
    return json({ detail: 'Unexpected request' }, 500);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const origin = () => window.location.origin;
const field = (label: string) => screen.getByLabelText(label);

async function fillForm(overrides: Record<string, string> = {}) {
  const values = { 'File name or reference': 'Smith kitchen', 'Client name': 'Smith Family', 'Signer name': 'Jordan Smith', 'Signer email': 'jordan@example.com', ...overrides };
  for (const [label, value] of Object.entries(values)) { await userEvent.clear(field(label)); if (value) await userEvent.type(field(label), value); }
  await userEvent.selectOptions(field('Agreement'), overrides.Agreement ?? 'a1');
}

it('shows a helpful empty state and opens the new-file form', async () => {
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByText('No files yet')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
  expect(screen.getByRole('heading', { name: 'New file' })).toBeInTheDocument();
});

it('checks the form before sending anything to the server', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await fillForm({ 'Client name': '', 'Signer email': 'not-an-email' });
  await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
  expect(screen.getByText('Enter the client’s name.')).toBeInTheDocument();
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
});

it('lists agreements without signature boxes but does not let them be chosen', async () => {
  render(<FilesPage agreements={[mind, blank]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  const option = within(field('Agreement')).getByRole('option', { name: /Blank agreement/ });
  expect(option).toBeDisabled();
  expect(option).toHaveTextContent('add signature boxes first');
});

it('creates and sends in one step, then shows the full link to copy', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
  expect(await screen.findByRole('heading', { name: 'Smith kitchen', level: 2 })).toBeInTheDocument();
  expect(screen.getByTestId('file-status')).toHaveTextContent('Sent');
  const link = screen.getByLabelText('Signing link');
  expect(link).toHaveValue(`${origin()}/sign#token-1`);
  await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${origin()}/sign#token-1`);
  expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  expect(screen.getByText(/shown only now/i)).toBeInTheDocument();
  expect(requests.map(r => `${r.method} ${r.url}`)).toEqual(expect.arrayContaining(['POST /api/files', 'POST /api/files/f1/send']));
});

it('saves a draft, edits it with the version check, then sends it', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  expect(await screen.findByTestId('file-status')).toHaveTextContent('Draft');
  expect(screen.queryByLabelText('Signing link')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await userEvent.clear(field('Signer name'));
  await userEvent.type(field('Signer name'), 'Alex Smith');
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Alex Smith')).toBeInTheDocument();
  expect(requests.find(r => r.method === 'PATCH')!.body).toEqual({ version: 0, title: 'Smith kitchen', client_name: 'Smith Family', signer_name: 'Alex Smith', signer_email: 'jordan@example.com', agreement_id: 'a1' });
  await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
  expect(await screen.findByLabelText('Signing link')).toHaveValue(`${origin()}/sign#token-1`);
});

it('asks before reissuing a link, then shows the new one', async () => {
  files = [makeFile({ status: 'viewed', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1 })];
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reissue link' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('stop working');
  expect(requests.some(r => r.url.endsWith('/link'))).toBe(false);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
  expect(await screen.findByLabelText('Signing link')).toHaveValue(`${origin()}/sign#token-1`);
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
});

it('offers the signed PDF for a signed file, with its timeline and no delete', async () => {
  files = [makeFile({ status: 'signed', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', signed_at: '2026-11-09T13:00:00+00:00', field_count: 1 })];
  ['created', 'sent', 'viewed', 'signed'].forEach(type => event('f1', type));
  render(<FilesPage agreements={[mind]} />);
  const download = await screen.findByRole('link', { name: 'Download signed PDF' });
  expect(download).toHaveAttribute('href', '/api/files/f1/signed.pdf');
  expect(download).toHaveAttribute('download');
  const timeline = await screen.findByRole('list', { name: 'Timeline' });
  for (const label of ['Created', 'Sent', 'Opened by signer', 'Signed']) expect(timeline).toHaveTextContent(label);
  expect(timeline).toHaveTextContent('203.0.113.7');
  expect(screen.queryByRole('button', { name: 'Delete file' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reissue link' })).not.toBeInTheDocument();
});

it('deletes a draft only after confirmation', async () => {
  files = [makeFile()];
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete file' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(files).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Delete file' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByText('No files yet')).toBeInTheDocument();
  expect(files).toHaveLength(0);
});

it('shows a server error and keeps the draft when sending fails', async () => {
  files = [makeFile()];
  failSend = true;
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send for signature' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send');
  expect(screen.getByTestId('file-status')).toHaveTextContent('Draft');
  failSend = false;
  await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
  expect(await screen.findByLabelText('Signing link')).toBeInTheDocument();
});

it('finds files by search and by status', async () => {
  files = [makeFile({ title: 'Smith kitchen' }), makeFile({ title: 'Lee bathroom', client_name: 'Lee Co', status: 'signed' })];
  render(<FilesPage agreements={[mind]} />);
  const list = await screen.findByRole('list', { name: 'Files' });
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
  await userEvent.type(screen.getByLabelText('Search files'), 'lee');
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(list).toHaveTextContent('Lee bathroom');
  await userEvent.clear(screen.getByLabelText('Search files'));
  await userEvent.click(screen.getByRole('button', { name: 'Draft', pressed: false }));
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(list).toHaveTextContent('Smith kitchen');
});

it('reloads when staff come back to the window, so signatures made elsewhere appear', async () => {
  files = [makeFile({ status: 'sent', document_name: 'MIND agreement', field_count: 1 })];
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByTestId('file-status')).toHaveTextContent('Sent');
  files[0] = { ...files[0], status: 'signed', signed_at: '2026-11-09T13:00:00+00:00' };
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(screen.getByTestId('file-status')).toHaveTextContent('Signed'));
});

// --- things happening at the same time --------------------------------------------------------------

it('a refresh that started before a send cannot put the file back to Draft', async () => {
  files = [makeFile()];
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByTestId('file-status')).toHaveTextContent('Draft');
  holdList = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });  // refresh starts: server still says Draft
  await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
  expect(await screen.findByLabelText('Signing link')).toBeInTheDocument();
  await act(async () => { releaseList!(); });  // the old answer arrives late
  expect(screen.getByTestId('file-status')).toHaveTextContent('Sent');
});

it('a file created during a slow refresh stays in the list', async () => {
  render(<FilesPage agreements={[mind]} />);
  await screen.findByText('No files yet');
  holdList = true;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
  await fillForm();
  await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  expect(await screen.findByRole('heading', { name: 'Smith kitchen', level: 2 })).toBeInTheDocument();
  await act(async () => { releaseList!(); });  // answered before the file existed
  expect(screen.getByRole('heading', { name: 'Smith kitchen', level: 2 })).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Files' })).getAllByRole('listitem')).toHaveLength(1);
});

it('typing in the new-file form survives a refresh that changes the selection', async () => {
  render(<FilesPage agreements={[mind]} />);
  await screen.findByText('No files yet');
  await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
  await userEvent.type(field('File name or reference'), 'Half-typed job');
  files = [makeFile({ title: 'Created in another tab' })];
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(within(screen.getByRole('list', { name: 'Files' })).getAllByRole('listitem')).toHaveLength(1));
  expect(field('File name or reference')).toHaveValue('Half-typed job');
});

it('stops editing when the file being edited is removed elsewhere, so another file is never overwritten', async () => {
  files = [makeFile({ title: 'Older draft' }), makeFile({ title: 'Newer draft' })];
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByRole('heading', { name: 'Newer draft', level: 2 })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  files = files.filter(f => f.title !== 'Newer draft');
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(await screen.findByRole('heading', { name: 'Older draft', level: 2 })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
});

it('a failed delete closes the confirmation and shows why', async () => {
  files = [makeFile()];
  failDelete = true;
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Delete file' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(files).toHaveLength(1);
});

it('picks a ready agreement as soon as agreements arrive, even if the form opened first', async () => {
  const view = render(<FilesPage agreements={[]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  expect(field('Agreement')).toHaveValue('');
  view.rerender(<FilesPage agreements={[blank, mind]} />);
  await waitFor(() => expect(field('Agreement')).toHaveValue('a1'));
});

it('labels the status filters as a group for screen readers', async () => {
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByRole('group', { name: 'Filter by status' })).toBeInTheDocument();
});
