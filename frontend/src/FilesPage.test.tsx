import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FilesPage from './FilesPage';
import type { Agreement } from './api';
import type { FileItem } from './files';

const mind: Agreement = { id: 'a1', name: 'MIND agreement', filename: 'MIND.pdf', page_count: 2, version: 1, created_at: '', updated_at: '', marks: [{ id: 'm1', page: 2, x: .1, y: .5, width: .3, height: .08 }] };
const blank: Agreement = { ...mind, id: 'a2', name: 'Blank agreement', marks: [] };

// --- an in-memory backend with the same rules as the real one ---------------------------------------
let files: FileItem[];
let events: Record<string, { type: string; at: string; ip: string | null; user_agent: string | null; detail: string | null }[]>;
let tokens: number;
let nextId: number;
let failSend: boolean;
let failDelete: boolean;
let holdList: boolean;
let releaseList: (() => void) | null;
let requests: { method: string; url: string; body?: any }[];
let emailSetup: 'sending' | 'not_configured' | 'limit_reached';
let pendingEmail: Record<string, string>;  // delivered after the response, like the real background task

function json(body: unknown, status = 200) { return new Response(status === 204 ? null : JSON.stringify(body), { status }); }
function event(id: string, type: string, detail: string | null = null) { (events[id] ??= []).push({ type, at: '2026-11-09T12:00:00+00:00', ip: type === 'viewed' || type === 'signed' ? '203.0.113.7' : null, user_agent: null, detail }); }
function emailResult(file: FileItem, body?: { email?: boolean }) {
  if (body?.email === false) return 'off';
  if (emailSetup === 'sending') pendingEmail[file.id] = file.signer_email;
  return emailSetup;
}
function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  nextId += 1;
  return { id: `f${nextId}`, title: 'Smith kitchen', client_name: 'Smith Family', signer_name: 'Jordan Smith', signer_email: 'jordan@example.com', agreement_id: 'a1', message: null, status: 'draft',
    document_name: null, document_sha256: null, page_count: null, version: 0, created_at: `2026-11-09T12:${String(nextId).padStart(2, "0")}:00+00:00`, updated_at: '2026-11-09T12:00:00+00:00',
    sent_at: null, viewed_at: null, signed_at: null, field_count: 0, reminders_sent: 0, next_reminder_at: null, ...overrides };
}

beforeEach(() => {
  files = []; events = {}; tokens = 0; nextId = 0; failSend = false; failDelete = false; holdList = false; releaseList = null; requests = []; emailSetup = 'sending'; pendingEmail = {};
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
    if (action === 'events') {
      const answer = json(JSON.parse(JSON.stringify(events[file.id] ?? [])));
      if (pendingEmail[file.id]) { event(file.id, 'email_sent', pendingEmail[file.id]); delete pendingEmail[file.id]; }
      return answer;
    }
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
      event(file.id, body?.email === false || emailSetup !== 'sending' ? 'link_created' : 'sent');
      return json({ file, signing_path: `/sign#token-${++tokens}`, email: emailResult(file, body) });
    }
    if (action === 'link') { event(file.id, 'link_reissued'); return json({ file, signing_path: `/sign#token-${++tokens}`, email: emailResult(file, body) }); }
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
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
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
  await waitFor(() => expect(screen.getAllByText('Alex Smith')).toHaveLength(2));  // the list row and the file's details
  expect(requests.find(r => r.method === 'PATCH')!.body).toEqual({ version: 0, title: 'Smith kitchen', client_name: 'Smith Family', signer_name: 'Alex Smith', signer_email: 'jordan@example.com', agreement_id: 'a1', message: '' });
  await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
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
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not send');
  expect(screen.getByTestId('file-status')).toHaveTextContent('Draft');
  failSend = false;
  await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
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
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
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

// --- emailing the signing link ------------------------------------------------------------------------

it('emails the link with a personal message by default, and shows the delivery on the timeline', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await fillForm();
  await userEvent.type(field('Personal message (optional)'), 'Hi Jordan,{enter}Here is the agreement.');
  expect(field('Email the link to the signer')).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
  expect(await screen.findByText(/emailing this link to Jordan Smith/i)).toHaveTextContent('jordan@example.com');
  expect(requests.find(r => r.method === 'POST' && r.url === '/api/files')!.body.message).toBe('Hi Jordan,\nHere is the agreement.');
  expect(requests.find(r => r.url.endsWith('/send'))!.body).toEqual({ email: true, reminders: true, utc_offset_minutes: -new Date().getTimezoneOffset() });  // the company's Date item is the sender's date
  expect(screen.getByLabelText('Signing link')).toHaveValue(`${origin()}/sign#token-1`);  // copying still works
  const timeline = screen.getByRole('list', { name: 'Timeline' });
  expect(await within(timeline).findByText('Email sent', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(within(timeline).getByText('to jordan@example.com')).toBeInTheDocument();
  expect(screen.getByText(/Here is the agreement/)).toBeInTheDocument();  // the message is shown on the file
}, 10000);

it('can send without emailing, for staff who share the link another way', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await fillForm();
  await userEvent.click(field('Email the link to the signer'));
  await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
  expect(await screen.findByText(/Send this link to Jordan Smith/)).toBeInTheDocument();
  expect(requests.find(r => r.url.endsWith('/send'))!.body).toEqual({ email: false, reminders: false, utc_offset_minutes: -new Date().getTimezoneOffset() });
});

it('says so when email is not set up, so staff copy the link', async () => {
  emailSetup = 'not_configured';
  files = [makeFile()];
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send for signature' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
  expect(await screen.findByText(/Email isn’t set up/)).toBeInTheDocument();
  expect(requests.find(r => r.url.endsWith('/send'))!.body).toEqual({ email: true, reminders: true, utc_offset_minutes: -new Date().getTimezoneOffset() });  // the company's Date item is the sender's date
});

it('lets staff choose whether a reissued link is emailed', async () => {
  files = [makeFile({ status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1 })];
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reissue link' }));
  const dialog = screen.getByRole('dialog');
  const box = within(dialog).getByLabelText('Email the new link to the signer');
  expect(box).toBeChecked();
  await userEvent.click(box);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
  expect(await screen.findByLabelText('Signing link')).toHaveValue(`${origin()}/sign#token-1`);
  expect(requests.find(r => r.url.endsWith('/link'))!.body).toEqual({ email: false, reminders: false });
});

it('shows an undelivered email on the timeline', async () => {
  files = [makeFile({ status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1 })];
  event(files[0].id, 'email_failed', 'jordan@example.com');
  render(<FilesPage agreements={[mind]} />);
  const timeline = await screen.findByRole('list', { name: 'Timeline' });
  expect(await within(timeline).findByText('Email not delivered')).toBeInTheDocument();
  expect(within(timeline).getByText('to jordan@example.com')).toBeInTheDocument();
});

it('limits the personal message to 2,000 characters', async () => {
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  expect(field('Personal message (optional)')).toHaveAttribute('maxLength', '2000');
});

it('explains when the daily email limit is reached, so staff copy the link', async () => {
  emailSetup = 'limit_reached';
  files = [makeFile()];
  render(<FilesPage agreements={[mind]} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Send for signature' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));  // after checking the details
  expect(await screen.findByText(/daily email limit/i)).toHaveTextContent('send this link to Jordan Smith yourself');
});

it('file rows show the client and the signer, and the name once when they are the same', async () => {
  files = [makeFile({ title: 'Kitchen', client_name: 'Smith Family', signer_name: 'Jordan Smith' }), makeFile({ title: 'Garage', client_name: 'Jo Lee', signer_name: 'Jo Lee' })];
  render(<FilesPage agreements={[mind]} />);
  const kitchen = await screen.findByRole('button', { name: /^Kitchen/ });
  expect(within(kitchen).getByText('Smith Family')).toBeInTheDocument();
  expect(within(kitchen).getByText('Jordan Smith')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /^Garage/ })).getAllByText('Jo Lee')).toHaveLength(1);
});

it('shows the reminders a waiting file has had and when the next one goes out', async () => {
  files = [makeFile({ status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1, reminders_sent: 2, next_reminder_at: '2026-11-11T12:30:00+00:00' })];
  ['created', 'sent'].forEach(type => event('f1', type));
  event('f1', 'reminder_sent', 'jordan@example.com');
  event('f1', 'reminder_failed', 'jordan@example.com');
  render(<FilesPage agreements={[mind]} />);
  const reminders = (await screen.findByText('Reminders')).closest('div')!;
  expect(reminders).toHaveTextContent('2 sent');
  expect(reminders).toHaveTextContent(/Next .*(Nov 11|11 Nov)/);  // the browser's own date format
  expect(await screen.findByText('Reminder sent')).toBeInTheDocument();
  const timeline = screen.getByRole('list', { name: 'Timeline' });
  expect(timeline).toHaveTextContent('Reminder not delivered');
});

it('a signed file shows the company was told, and no next reminder', async () => {
  files = [makeFile({ status: 'signed', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', signed_at: '2026-11-09T13:00:00+00:00', field_count: 1, reminders_sent: 1 })];
  ['created', 'sent', 'reminder_sent', 'signed'].forEach(type => event('f1', type));
  event('f1', 'signed_notice_sent', 'ana@riverside.example');
  render(<FilesPage agreements={[mind]} />);
  expect(await screen.findByText('Company notified')).toBeInTheDocument();
  const reminders = screen.getByText('Reminders').closest('div')!;
  expect(reminders).toHaveTextContent('1 sent');
  expect(reminders).not.toHaveTextContent('Next');
});

describe('how the link reaches the client', () => {
  const REMIND = 'Remind them every day for up to 7 days if it isn’t signed';

  it('reminders are a choice under the email box, on by default', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    expect(field('Email the link to the signer')).toBeChecked();
    expect(field(REMIND)).toBeChecked();
    expect(field(REMIND)).toBeEnabled();
  });

  it('without the email, the reminders and the personal message are greyed out', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    await userEvent.click(field('Email the link to the signer'));
    expect(field(REMIND)).toBeDisabled();
    expect(field(REMIND)).not.toBeChecked();
    expect(field('Personal message (optional)')).toBeDisabled();
    await userEvent.click(field('Email the link to the signer'));  // ticked again: both come back, reminders still on
    expect(field(REMIND)).toBeChecked();
    expect(field('Personal message (optional)')).toBeEnabled();
  });

  it('a message typed before unticking the email is not kept, so no later email sends it', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    await fillForm();
    await userEvent.type(field('Personal message (optional)'), 'Hi Jordan');
    await userEvent.click(field('Email the link to the signer'));
    await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));
    await screen.findByLabelText('Signing link');
    expect(requests.find(r => r.method === 'POST' && r.url === '/api/files')!.body.message).toBe('');
  });

  it('the link can be emailed without reminders', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    await fillForm();
    await userEvent.click(field(REMIND));
    await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
    const check = screen.getByRole('dialog', { name: 'Check the details before sending' });
    expect(within(check).getByText('Yes, without reminders')).toBeInTheDocument();
    await userEvent.click(within(check).getByRole('button', { name: 'Confirm and send' }));
    await screen.findByLabelText('Signing link');
    expect(requests.find(r => r.url.endsWith('/send'))!.body).toEqual({ email: true, reminders: false, utc_offset_minutes: -new Date().getTimezoneOffset() });
  });

  it('a link shared by staff shows as "Link created, not emailed", not "Sent by email"', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    await fillForm();
    await userEvent.click(field('Email the link to the signer'));
    await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm and send' }));
    const timeline = await screen.findByRole('list', { name: 'Timeline' });
    expect(await within(timeline).findByText('Link created, not emailed')).toBeInTheDocument();
    expect(within(timeline).queryByText('Sent by email')).not.toBeInTheDocument();
  });

  it('sending a draft and reissuing a link offer the same choice', async () => {
    files = [makeFile({ title: 'Draft job' }), makeFile({ title: 'Waiting job', status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1 })];
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click(await screen.findByRole('button', { name: /Draft job/ }));
    await screen.findByRole('button', { name: 'Send for signature' });
    await userEvent.click(field('Email the link to the signer'));
    expect(field(REMIND)).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /Waiting job/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reissue link' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(REMIND)).toBeChecked();
    await userEvent.click(within(dialog).getByLabelText(REMIND));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }));
    await screen.findByLabelText('Signing link');
    expect(requests.find(r => r.url.endsWith('/link'))!.body).toEqual({ email: true, reminders: false });
  });
});

describe('filling a new file from an earlier client', () => {
  beforeEach(() => {
    files = [makeFile({ title: 'Patel kitchen', client_name: 'Patel Family', signer_name: 'Smit Patel', signer_email: 'smit@gmail.com', status: 'signed' }),
             makeFile({ title: 'Patel garden', client_name: 'Patel Family', signer_name: 'Riya Patel', signer_email: 'riya@gmail.com', status: 'draft' })];
  });
  const openForm = async () => {
    render(<FilesPage agreements={[mind]} />);
    await screen.findByText('Patel kitchen');
    await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
  };

  it('typing part of a client name lists every earlier signer; picking one fills the three fields only', async () => {
    await openForm();
    await userEvent.type(field('Client name'), 'pat');
    const options = within(screen.getByRole('listbox', { name: 'Earlier clients' })).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Patel FamilyRiya Patelriya@gmail.com', 'Patel FamilySmit Patelsmit@gmail.com']);
    await userEvent.click(options[1]);
    expect(field('Client name')).toHaveValue('Patel Family');
    expect(field('Signer name')).toHaveValue('Smit Patel');
    expect(field('Signer email')).toHaveValue('smit@gmail.com');
    expect(field('File name or reference')).toHaveValue('');  // a new job gets its own name
    expect(field('Personal message (optional)')).toHaveValue('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('works from the keyboard, and Enter in the list never sends the file', async () => {
    await openForm();
    await userEvent.type(field('Client name'), 'Patel');
    expect(field('Client name')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field('Signer name')).toHaveValue('Smit Patel');
    expect(requests.some(r => r.method === 'POST')).toBe(false);
    await userEvent.clear(field('Client name'));
    await userEvent.type(field('Client name'), 'Pat');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field('Client name')).toHaveAttribute('aria-expanded', 'false');
  });

  it('a filled field can be changed, and a new client simply gets no list', async () => {
    await openForm();
    await userEvent.type(field('Client name'), 'Pat');
    await userEvent.click(screen.getAllByRole('option')[0]);
    await userEvent.clear(field('Signer email'));
    await userEvent.type(field('Signer email'), 'riya@work.com');
    expect(field('Signer email')).toHaveValue('riya@work.com');
    await userEvent.clear(field('Client name'));
    await userEvent.type(field('Client name'), 'Brand new client');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('a long list can be scrolled with the mouse, and the arrow keys keep the highlighted line in view', async () => {
    files = Array.from({ length: 12 }, (_, n) => makeFile({ title: `Job ${n}`, client_name: `Patel ${n}`, signer_name: `Signer ${n}`, signer_email: `s${n}@x.co` }));
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<FilesPage agreements={[mind]} />);
    await screen.findByText('Job 0');
    await userEvent.click(screen.getAllByRole('button', { name: 'New file' })[0]);
    await userEvent.type(field('Client name'), 'Patel');
    const list = screen.getByRole('listbox', { name: 'Earlier clients' });
    expect(within(list).getAllByRole('option')).toHaveLength(12);  // no limit
    expect(fireEvent.mouseDown(list)).toBe(false);  // grabbing the scrollbar keeps the box focused, so the list stays open
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(field('Client name')).toHaveAttribute('aria-activedescendant', 'client-suggestion-2');
  });

  it('the box only points to the list while the list is shown', async () => {
    await openForm();
    expect(field('Client name')).not.toHaveAttribute('aria-controls');
    await userEvent.type(field('Client name'), 'Pat');
    expect(field('Client name')).toHaveAttribute('aria-controls', 'client-suggestions');
  });

  it('editing a draft offers no list', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Patel garden/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.clear(field('Client name'));
    await userEvent.type(field('Client name'), 'Pat');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('checking the details before sending', () => {
  it('Create and send first shows every detail; nothing is created until it is confirmed', async () => {
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
    await fillForm();
    await userEvent.type(field('Personal message (optional)'), 'Hi Jordan');
    await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
    const dialog = screen.getByRole('dialog', { name: 'Check the details before sending' });
    for (const text of ['Smith kitchen', 'Smith Family', 'Jordan Smith', 'jordan@example.com', 'MIND agreement', 'Hi Jordan', 'Yes, with a daily reminder for up to 7 days'])
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back and edit' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field('Signer email')).toHaveValue('jordan@example.com');  // nothing lost
    expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm and send' }));
    expect(await screen.findByTestId('file-status')).toHaveTextContent('Sent');
    expect(requests.map(r => `${r.method} ${r.url}`)).toEqual(expect.arrayContaining(['POST /api/files', 'POST /api/files/f1/send']));
  });

  it('sending a draft also asks to check its details first', async () => {
    files = [makeFile({ title: 'Patel garden', client_name: 'Patel', signer_name: 'Riya Patel', signer_email: 'riya@example.com' })];
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send for signature' }));
    const dialog = screen.getByRole('dialog', { name: 'Check the details before sending' });
    expect(within(dialog).getByText('riya@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('MIND agreement')).toBeInTheDocument();
    expect(requests.some(r => r.url.endsWith('/send'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm and send' }));
    expect(await screen.findByLabelText('Signing link')).toBeInTheDocument();
  });
});

describe('live updates', () => {
  afterEach(() => vi.useRealTimers());

  it('the file and its timeline update by themselves when the signer acts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sent = makeFile({ status: 'sent', document_name: 'MIND agreement', sent_at: '2026-11-09T12:30:00+00:00', field_count: 1, version: 1 });
    files = [sent];
    event(sent.id, 'sent');
    render(<FilesPage agreements={[mind]} />);
    expect(await screen.findByTestId('file-status')).toHaveTextContent('Sent');

    Object.assign(sent, { status: 'signed', signed_at: '2026-11-09T13:00:00+00:00', version: 3 });  // signed in another browser
    event(sent.id, 'viewed'); event(sent.id, 'signed'); event(sent.id, 'signed_notice_sent', 'owner@example.com');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByTestId('file-status')).toHaveTextContent('Signed');
    expect(within(screen.getByRole('list', { name: 'Timeline' })).getByText('Company notified')).toBeInTheDocument();
  });
});

describe('live updates never act on stale work', () => {
  afterEach(() => vi.useRealTimers());

  it('an open edit form keeps its version, so another tab’s change is reported, not overwritten', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const draft = makeFile({ title: 'Patel garden' });
    files = [draft];
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    Object.assign(draft, { signer_email: 'changed@elsewhere.com', version: 1 });  // edited in another tab
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    await userEvent.clear(field('Signer name'));
    await userEvent.type(field('Signer name'), 'Alex Smith');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/changed in another tab/)).toBeInTheDocument();
    expect(draft.signer_email).toBe('changed@elsewhere.com');
  });

  it('the send check closes if its file disappears, so another file is never sent by mistake', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = makeFile({ title: 'First job' });
    const second = makeFile({ title: 'Second job' });
    files = [first, second];
    render(<FilesPage agreements={[mind]} />);
    await userEvent.click(await screen.findByRole('button', { name: /^First job/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send for signature' }));
    expect(screen.getByRole('dialog', { name: 'Check the details before sending' })).toBeInTheDocument();
    files = files.filter(f => f !== first);  // deleted in another tab
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.queryByRole('dialog', { name: 'Check the details before sending' })).not.toBeInTheDocument();
    expect(requests.some(r => r.url.endsWith('/send'))).toBe(false);
  });
});
