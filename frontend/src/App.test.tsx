import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./PdfEditor', () => ({ default: ({ onChange, marks }: any) => <button onClick={() => onChange([...marks, { id: 'test-field', page: 1, x: .1, y: .6, width: .3, height: .1 }])}>Draw test field</button> }));

const account = { user: { id: 'u1', name: 'Ana Lopez', email: 'ana@riverside.example' }, organization: { id: 'o1', name: 'Riverside Builders' } };
const onLogout = vi.fn();
const agreement = { id: 'abc', name: 'Consulting agreement', filename: 'Consulting agreement.pdf', page_count: 2, marks: [], version: 0, created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z' };
let records: any[];
let sentFiles: any[];
let failSave: boolean;
let failDelete: boolean;
beforeEach(() => {
  records = [];
  sentFiles = [];
  failSave = false;
  failDelete = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url.startsWith('/api/files')) {
      if (url === '/api/files' && options?.method === 'POST') {
        sentFiles.push({ ...JSON.parse(options.body as string), id: 'f1', status: 'draft', version: 0, field_count: 0, document_name: null, document_sha256: null, page_count: null, created_at: '', updated_at: '', sent_at: null, viewed_at: null, signed_at: null });
        return new Response(JSON.stringify(sentFiles[0]), { status: 201 });
      }
      if (url.endsWith('/send')) { sentFiles[0] = { ...sentFiles[0], status: 'sent', version: 1 }; return new Response(JSON.stringify({ file: sentFiles[0], signing_path: '/sign#secret-shown-once' })); }
      if (url.endsWith('/events')) return new Response(JSON.stringify([]));
      return new Response(JSON.stringify(sentFiles));
    }
    if (options?.method === 'DELETE') {
      if (failDelete) return new Response(JSON.stringify({ detail: 'Could not delete. Try again.' }), { status: 503 });
      records = records.filter(item => !url.endsWith(`/${item.id}`));
      return new Response(null, { status: 204 });
    }
    if (options?.method === 'POST') { records.push({ ...agreement }); return new Response(JSON.stringify(agreement), { status: 201 }); }
    if (options?.method === 'PUT') {
      if (failSave) return new Response(JSON.stringify({ detail: 'Could not save. Try again.' }), { status: 500 });
      const data = JSON.parse(options.body as string);
      records[0] = { ...records[0], marks: data.marks, version: 1 };
      return new Response(JSON.stringify(records[0]));
    }
    return new Response(JSON.stringify(url.endsWith('/abc') ? records[0] : records));
  }));
});

it('shows exactly the two requested navigation tabs and a useful empty state', async () => {
  render(<App account={account} onLogout={onLogout} />);
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(await screen.findByText('Your first agreement starts here')).toBeInTheDocument();
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Agreements', 'Files']);
  await userEvent.click(screen.getByRole('tab', { name: /Files/ }));
  expect(await screen.findByText('No files yet')).toBeInTheDocument();
});

it('uploads a PDF, edits marks, saves them, and restores them on remount', async () => {
  const view = render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Your first agreement starts here');
  fireEvent.change(screen.getByLabelText('Upload PDF file'), { target: { files: [new File(['%PDF'], 'Consulting agreement.pdf', { type: 'application/pdf' })] } });
  await screen.findByRole('heading', { name: 'Consulting agreement' });
  await userEvent.click(screen.getByText('Draw test field'));
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
  await screen.findByText('All changes saved');
  expect(records[0].marks).toHaveLength(1);
  view.unmount();
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByRole('heading', { name: 'Consulting agreement' });
  expect(screen.getByText('1 signature field')).toBeInTheDocument();
});

it('keeps local changes and displays the error when a save fails', async () => {
  records = [{ ...agreement }];
  failSave = true;
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Draw test field');
  await userEvent.click(screen.getByText('Draw test field'));
  await userEvent.click(screen.getByRole('button', { name: 'Save template' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save template' })).toBeEnabled();
});

it('asks before switching tabs when there are unsaved changes', async () => {
  records = [{ ...agreement }];
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Draw test field');
  await userEvent.click(screen.getByText('Draw test field'));
  await userEvent.click(screen.getByRole('tab', { name: /Files/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Unsaved changes');
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('rejects non-PDF uploads before sending them', async () => {
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Your first agreement starts here');
  fireEvent.change(screen.getByLabelText('Upload PDF file'), { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF'));
  expect(records).toHaveLength(0);
});

it('confirms deletion, preserves unsaved work on cancel, and clears the last agreement', async () => {
  records = [{ ...agreement }];
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Draw test field');
  expect(screen.getByRole('link', { name: /Astra Sign/ })).toBeInTheDocument();
  await userEvent.click(screen.getByText('Draw test field'));
  await userEvent.click(screen.getByRole('button', { name: 'Delete agreement' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Consulting agreement');
  expect(records).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Delete agreement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByText('Your first agreement starts here');
  expect(records).toHaveLength(0);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('opens the next agreement after deleting the selected agreement', async () => {
  records = [{ ...agreement }, { ...agreement, id: 'keep', name: 'Keep this agreement' }];
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Draw test field');
  await userEvent.click(screen.getByRole('button', { name: 'Delete agreement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByRole('heading', { name: 'Keep this agreement' });
  expect(records).toHaveLength(1);
});

it('preserves the agreement and edits when deletion fails, and allows retry', async () => {
  records = [{ ...agreement }]; failDelete = true;
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByText('Draw test field');
  await userEvent.click(screen.getByText('Draw test field'));
  await userEvent.click(screen.getByRole('button', { name: 'Delete agreement' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not delete');
  expect(records).toHaveLength(1);
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  failDelete = false;
  await userEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await screen.findByText('Your first agreement starts here');
});

it('keeps the once-only signing link when staff switch to Agreements and back', async () => {
  records = [{ ...agreement, marks: [{ id: 'm1', page: 1, x: .1, y: .6, width: .3, height: .1 }] }];
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByRole('heading', { name: 'Consulting agreement' });
  await userEvent.click(screen.getByRole('tab', { name: /Files/ }));
  await userEvent.click((await screen.findAllByRole('button', { name: 'New file' }))[0]);
  await userEvent.type(screen.getByLabelText('File name or reference'), 'Smith job');
  await userEvent.type(screen.getByLabelText('Client name'), 'Smith Family');
  await userEvent.type(screen.getByLabelText('Signer name'), 'Jordan Smith');
  await userEvent.type(screen.getByLabelText('Signer email'), 'jordan@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Create and send' }));
  expect(await screen.findByLabelText('Signing link')).toHaveValue(`${window.location.origin}/sign#secret-shown-once`);
  await userEvent.click(screen.getByRole('tab', { name: /Agreements/ }));
  await userEvent.click(screen.getByRole('tab', { name: /Files/ }));
  expect(await screen.findByLabelText('Signing link')).toHaveValue(`${window.location.origin}/sign#secret-shown-once`);
});

it('counts only signature boxes as signature fields', async () => {
  records = [{ ...agreement, marks: [{ id: 's', page: 1, x: .1, y: .6, width: .3, height: .1 }, { id: 't', page: 1, x: .1, y: .1, width: .3, height: .03, type: 'text', text: 'Fee' }, { id: 'c', page: 1, x: .5, y: .1, width: .3, height: .05, type: 'comment', text: 'Tick' }] },
             { ...agreement, id: 'notes', name: 'Notes only', marks: [{ id: 'c', page: 1, x: .5, y: .1, width: .3, height: .05, type: 'comment', text: 'Tick' }] }];
  render(<App account={account} onLogout={onLogout} />);
  await screen.findByRole('heading', { name: 'Consulting agreement' });
  expect(screen.getByText('1 signature field')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Notes only/ })).toHaveTextContent('Draft');
});

it('shows who is signed in and logs out from the header', async () => {
  render(<App account={account} onLogout={onLogout} />);
  expect(await screen.findByText('Riverside Builders')).toBeInTheDocument();
  expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
  expect(screen.getByLabelText('Signed in as Ana Lopez')).toHaveTextContent('AL');
  await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
  expect(onLogout).toHaveBeenCalled();
});
