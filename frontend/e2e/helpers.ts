import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple';
let counter = 0;

/** Emails the test backend wrote to its outbox folder (never sent) for one address, oldest first. */
export function emailsTo(address: string): { to: string; subject: string; text: string; html: string }[] {
  const outbox = process.env.ASTRA_E2E_OUTBOX!;
  return readdirSync(outbox).filter(name => name.endsWith('.json')).sort()
    .map(name => JSON.parse(readFileSync(join(outbox, name), 'utf-8'))).filter(message => message.to === address);
}

/** The confirmation link emailed to this address after sign-up. */
export async function confirmationLink(address: string): Promise<string> {
  const subject = 'Confirm your email for Astra Sign';
  await expect.poll(() => emailsTo(address).filter(message => message.subject === subject).length, { timeout: 10000 }).toBeGreaterThan(0);
  const text = emailsTo(address).filter(message => message.subject === subject).at(-1)!.text;
  return /https?:\/\/\S+\/confirm-email#[A-Za-z0-9_-]{43,}/.exec(text)![0];
}

/** Create a fresh company account, confirm its email from the outbox, and log the page's browser in (page.request shares its cookies). */
export async function signUp(page: Page, company = 'Browser Test Co', email = `staff-${Date.now()}-${process.pid}-${++counter}@example.com`) {
  const response = await page.request.post('/api/auth/signup', { data: { company, name: 'Pat Tester', email, password: PASSWORD } });
  expect(response.status()).toBe(201);
  const token = new URL(await confirmationLink(email)).hash.slice(1);
  expect((await page.request.post('/api/auth/confirm', { data: { token, password: PASSWORD } })).status()).toBe(200);
  expect((await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);  // sign-up alone doesn't log in
  return { email, company };
}
