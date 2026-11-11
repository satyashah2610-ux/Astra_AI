import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_LABELS, fileApi, matchSigners, pastSigners, sendable, signingUrl, STATUS_LABELS, validateFile, type FileItem, type FileValues } from './files';
import type { Agreement } from './api';

const agreement = (marks = 1): Agreement => ({ id: 'a1', name: 'MIND agreement', filename: 'MIND.pdf', page_count: 2, version: 1, created_at: '', updated_at: '',
  marks: Array.from({ length: marks }, (_, i) => ({ id: `m${i}`, page: 1, x: .1, y: .5, width: .3, height: .08 })) });
const values = (overrides: Partial<FileValues> = {}): FileValues => ({ title: 'Smith kitchen', client_name: 'Smith Family', signer_name: 'Jordan Smith', signer_email: 'jordan@example.com', agreement_id: 'a1', message: '', ...overrides });

describe('signingUrl', () => {
  it('joins the app origin and the signing path', () => {
    expect(signingUrl('https://sign.example.com', '/sign#abc')).toBe('https://sign.example.com/sign#abc');
    expect(signingUrl('http://127.0.0.1:5173/', '/sign#abc')).toBe('http://127.0.0.1:5173/sign#abc');
  });
});

describe('validateFile', () => {
  it('accepts a complete file', () => {
    expect(validateFile(values(), [agreement()])).toEqual({});
  });
  it.each([
    [{ title: '  ' }, 'title'], [{ client_name: '' }, 'client_name'], [{ signer_name: '' }, 'signer_name'],
    [{ signer_email: 'not-an-email' }, 'signer_email'], [{ signer_email: 'a@b' }, 'signer_email'], [{ signer_email: 'a b@c.com' }, 'signer_email'],
    [{ title: 'x'.repeat(201) }, 'title'], [{ message: 'x'.repeat(2001) }, 'message'], [{ agreement_id: '' }, 'agreement_id'], [{ agreement_id: 'missing' }, 'agreement_id'],
  ] as [Partial<FileValues>, keyof FileValues][])('flags %o', (change, field) => {
    expect(Object.keys(validateFile(values(change), [agreement()]))).toEqual([field]);
  });
  it('accepts a message of up to 2,000 characters', () => {
    expect(validateFile(values({ message: 'x'.repeat(2000) }), [agreement()])).toEqual({});
  });
  it('rejects an agreement that has no signature boxes yet', () => {
    expect(validateFile(values(), [agreement(0)]).agreement_id).toMatch(/signature box/i);
  });
});

describe('sendable and labels', () => {
  it('requires at least one signature box', () => {
    expect(sendable(agreement(1))).toBe(true);
    expect(sendable(agreement(0))).toBe(false);
  });
  it('does not count company text or comments as signature boxes', () => {
    const notes = { ...agreement(0), marks: [{ id: 't', page: 1, x: .1, y: .1, width: .3, height: .03, type: 'text' as const, text: 'Fee' }, { id: 'c', page: 1, x: .1, y: .2, width: .3, height: .05, type: 'comment' as const, text: 'Tick here' }] };
    expect(sendable(notes)).toBe(false);
  });
  it('labels every status and event', () => {
    expect(STATUS_LABELS).toEqual({ draft: 'Draft', sent: 'Sent', viewed: 'Viewed', signed: 'Signed' });
    expect(Object.keys(EVENT_LABELS)).toEqual(['created', 'sent', 'link_reissued', 'viewed', 'signed', 'email_sent', 'email_failed',
      'reminder_sent', 'reminder_failed', 'signed_notice_sent', 'signed_notice_failed']);
    expect(EVENT_LABELS.email_sent).toBe('Email sent');
    expect(EVENT_LABELS.email_failed).toBe('Email not delivered');
  });
});

describe('fileApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the right method, URL and body for each call', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fileApi.list();
    await fileApi.create(values());
    await fileApi.update('f/1', 3, { signer_name: 'Alex' });
    await fileApi.send('f/1', true);
    await fileApi.reissue('f/1', false);
    await fileApi.events('f/1');
    fetch.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await fileApi.remove('f/1');
    const calls = (fetch.mock.calls as unknown as [string, RequestInit | undefined][]).map(([url, options]) => [url, options?.method ?? 'GET', options?.body ? JSON.parse(options.body as string) : undefined]);
    expect(calls).toEqual([
      ['/api/files', 'GET', undefined],
      ['/api/files', 'POST', values()],
      ['/api/files/f%2F1', 'PATCH', { version: 3, signer_name: 'Alex' }],
      ['/api/files/f%2F1/send', 'POST', { email: true }],
      ['/api/files/f%2F1/link', 'POST', { email: false }],
      ['/api/files/f%2F1/events', 'GET', undefined],
      ['/api/files/f%2F1', 'DELETE', undefined],
    ]);
    expect(fileApi.signedPdfUrl('f/1')).toBe('/api/files/f%2F1/signed.pdf');
  });

  it('trims values before sending them', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({})));
    vi.stubGlobal('fetch', fetch);
    await fileApi.create(values({ title: '  Smith kitchen  ', signer_email: ' jordan@example.com ', message: '  Hi Jordan  ' }));
    const [, options] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(JSON.parse(options.body as string)).toMatchObject({ title: 'Smith kitchen', signer_email: 'jordan@example.com', message: 'Hi Jordan' });
  });
});

describe('an expired session', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('announces that the user is logged out and still reports the error', async () => {
    const { LOGGED_OUT_EVENT } = await import('./api');
    const heard = vi.fn();
    window.addEventListener(LOGGED_OUT_EVENT, heard);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Log in to continue.' }), { status: 401 })));
    await expect(fileApi.list()).rejects.toThrow('Log in to continue.');
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(LOGGED_OUT_EVENT, heard);
  });
});

describe('past clients for the new-file form', () => {
  const file = (client_name: string, signer_name: string, signer_email: string, created_at: string, status: FileItem['status'] = 'sent'): FileItem => ({
    id: created_at, title: 'job', client_name, signer_name, signer_email, agreement_id: 'a1', message: null, status, document_name: null, document_sha256: null,
    page_count: null, version: 0, created_at, updated_at: created_at, sent_at: null, viewed_at: null, signed_at: null, field_count: 0, reminders_sent: 0, next_reminder_at: null });
  const files = [
    file('Patel Family', 'Smit Patel', 'smit@gmail.com', '2026-10-01T10:00:00+00:00', 'signed'),
    file('Patel Family', 'Smit Patel', 'SMIT@gmail.com', '2026-10-05T10:00:00+00:00'),  // same person: one line
    file('Patel Family', 'Riya Patel', 'riya@gmail.com', '2026-10-10T10:00:00+00:00', 'draft'),  // drafts count
    file('Patel Family', 'Smit Patel', 'smit@patelco.com', '2026-11-01T10:00:00+00:00'),  // a new email: its own line
    file('Smith Family', 'Jordan Smith', 'jordan@example.com', '2026-09-01T10:00:00+00:00'),
  ];

  it('lists each client, signer and email once, newest first, drafts included', () => {
    expect(pastSigners(files)).toEqual([
      { client_name: 'Patel Family', signer_name: 'Smit Patel', signer_email: 'smit@patelco.com' },
      { client_name: 'Patel Family', signer_name: 'Riya Patel', signer_email: 'riya@gmail.com' },
      { client_name: 'Patel Family', signer_name: 'Smit Patel', signer_email: 'SMIT@gmail.com' },
      { client_name: 'Smith Family', signer_name: 'Jordan Smith', signer_email: 'jordan@example.com' },
    ]);
  });

  it('matches what is typed in the client or signer name, ignoring case', () => {
    const all = pastSigners(files);
    expect(matchSigners(all, 'pat').map(s => s.signer_email)).toEqual(['smit@patelco.com', 'riya@gmail.com', 'SMIT@gmail.com']);
    expect(matchSigners(all, '  JORDAN ').map(s => s.client_name)).toEqual(['Smith Family']);
    expect(matchSigners(all, '')).toEqual([]);
    expect(matchSigners(all, 'nobody')).toEqual([]);
  });

  it('has no limit on how many it lists', () => {
    const many = Array.from({ length: 30 }, (_, n) => file(`Client ${n}`, `Signer ${n}`, `s${n}@x.co`, `2026-10-${String(n + 1).padStart(2, '0')}T10:00:00+00:00`));
    expect(matchSigners(pastSigners(many), 'client')).toHaveLength(30);
  });
});
