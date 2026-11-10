import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { emailsTo, signUp } from './helpers';

test('sending a file emails the signer a personal message and a link that opens the agreement', async ({ page, context }) => {
  const staff = await signUp(page, 'Email Test Co');
  // An agreement with one signature box, prepared through the API (the editor has its own tests).
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await page.request.post('/api/agreements', { multipart: { file: { name: 'Email agreement.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  const marks = [{ id: 'signature-1', page: 1, x: 0.1, y: 0.65, width: 0.3, height: 0.07 }];
  expect((await page.request.put(`/api/agreements/${agreement.id}/marks`, { data: { marks, version: 0 } })).status()).toBe(200);

  const signerEmail = `signer-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill('Email job 001');
  await page.getByLabel('Client name').fill('Email Client Ltd');
  await page.getByLabel('Signer name').fill('Morgan Reed');
  await page.getByLabel('Signer email').fill(signerEmail);
  await page.getByLabel('Agreement').selectOption({ label: 'Email agreement' });
  await page.getByLabel('Personal message (optional)').fill('Hi Morgan,\nHere is the agreement we discussed. <b>Thanks!</b>');
  await expect(page.getByLabel('Email the link to the signer')).toBeChecked();
  await page.getByRole('button', { name: 'Create and send' }).click();
  await expect(page.getByText(/Emailing this link to Morgan Reed/)).toBeVisible();
  const shownLink = await page.getByLabel('Signing link').inputValue();
  await expect(page.getByRole('list', { name: 'Timeline' }).getByText('Email sent')).toBeVisible({ timeout: 10000 });
  // Reminders are scheduled because the link was emailed (one a day until signed).
  const reminders = page.locator('.file-facts > div').filter({ hasText: 'Reminders' });
  await expect(reminders).toContainText('None sent yet');
  await expect(reminders).toContainText('Next');

  // The email, as the test backend wrote it to its outbox instead of sending it.
  const outbox = process.env.ASTRA_E2E_OUTBOX!;
  const forSigner = () => readdirSync(outbox).filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(readFileSync(join(outbox, name), 'utf-8'))).filter(message => message.to === signerEmail);
  await expect.poll(() => forSigner().length, { timeout: 10000 }).toBe(1);
  const email = forSigner()[0];
  expect(email.from_name).toBe('Pat Tester via Astra Sign');
  expect(email.subject).toBe('Pat Tester sent you Email agreement to sign');
  expect(email.html).toContain('Here is the agreement we discussed. &lt;b&gt;Thanks!&lt;/b&gt;');
  expect(email.text).toContain(shownLink);

  // The emailed link opens the signing page.
  const link = email.text.match(/https?:\/\/\S+\/sign#[A-Za-z0-9_-]+/)![0];
  expect(link).toBe(shownLink);
  const client = await context.newPage();
  await client.goto(link);
  await expect(client.getByRole('heading', { name: 'Email agreement' })).toBeVisible();
  await expect(client.getByLabel('Full name')).toHaveValue('Morgan Reed');

  // The client signs; the staff member who sent it gets an email, and the file shows it.
  await client.getByLabel(/I agree to sign this agreement electronically/).check();
  await client.getByRole('button', { name: 'Sign agreement' }).click();
  await expect(client.getByRole('heading', { name: 'You’ve signed Email agreement' })).toBeVisible();
  await expect.poll(() => emailsTo(staff.email).filter(message => message.subject === 'Morgan Reed signed Email agreement').length, { timeout: 10000 }).toBe(1);
  const notice = emailsTo(staff.email).find(message => message.subject === 'Morgan Reed signed Email agreement')!;
  expect(notice.text).toContain('Email job 001');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Signed');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Company notified');
  await expect(reminders).toHaveCount(0);  // signed before any reminder: nothing more to show
});
