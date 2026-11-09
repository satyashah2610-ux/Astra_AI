import { afterEach, describe, expect, it, vi } from 'vitest';
import { signingApi, tokenFromPath } from './signing';

const token = 'Abc_def-1234567890Abc_def-1234567890Abc_def';

describe('tokenFromPath', () => {
  it('reads the token from a signing link', () => {
    expect(tokenFromPath(`/sign/${token}`)).toBe(token);
    expect(tokenFromPath(`/sign/${token}/`)).toBe(token);
  });
  it.each(['/', '/sign', '/sign/', '/sign/short', `/signs/${token}`, `/sign/${token}/extra`, `/sign/${token}!`, `/api/sign/${token}`])('rejects %s', path => {
    expect(tokenFromPath(path)).toBeNull();
  });
});

describe('signingApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the token in a header, never in the URL', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'sent' })));
    vi.stubGlobal('fetch', fetch);
    const api = signingApi(token);
    await api.load();
    await api.markViewed();
    await api.submit({ name: 'Jordan', method: 'typed', image: 'data:image/png;base64,AAAA', consent: true });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, options]) => [url, options.method ?? 'GET'])).toEqual([['/api/signing', 'GET'], ['/api/signing/view', 'POST'], ['/api/signing/sign', 'POST']]);
    for (const [url, options] of calls) {
      expect(url).not.toContain(token);
      expect(new Headers(options.headers).get('X-Signing-Token')).toBe(token);
    }
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ name: 'Jordan', method: 'typed', image: 'data:image/png;base64,AAAA', consent: true });
    expect(api.pdf).toEqual({ url: '/api/signing/pdf', httpHeaders: { 'X-Signing-Token': token } });
  });

  it('surfaces the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'This signing link is invalid or has been replaced.' }), { status: 404 })));
    await expect(signingApi(token).load()).rejects.toThrow('invalid or has been replaced');
  });
});
