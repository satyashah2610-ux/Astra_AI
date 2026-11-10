import { test, expect } from '@playwright/test';
import { PASSWORD, signUp } from './helpers';

test('create a company account, log out, log back in', async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await page.screenshot({ path: 'test-results/auth-login.png', fullPage: true });
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Company name').fill('Riverside Builders');
  await page.getByLabel('Your name').fill('Ana Lopez');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Not straight into the workspace: a confirmation, then the login form with the email filled in.
  await expect(page.getByRole('status')).toHaveText('Account created. Log in to continue.');
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await expect(page.getByLabel('Work email')).toHaveValue(email);
  const emailBox = (await page.getByLabel('Work email').boundingBox())!;
  const passwordBox = (await page.getByLabel('Password', { exact: true }).boundingBox())!;
  expect(Math.abs(emailBox.width - passwordBox.width)).toBeLessThan(1);  // both boxes span the form
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Riverside Builders')).toBeVisible();
  await expect(page.getByRole('button', { name: /signed in as Ana Lopez/i })).toHaveText('AL');

  await page.reload();  // the session survives a reload
  await expect(page.getByText('Riverside Builders')).toBeVisible();

  await page.getByRole('button', { name: /signed in as Ana Lopez/i }).click();  // the initials open the account menu
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Riverside Builders')).toBeVisible();
});

test('another company sees none of your agreements or files', async ({ browser }) => {
  const alpha = await browser.newContext();
  const beta = await browser.newContext();
  const a = await alpha.newPage();
  const b = await beta.newPage();
  const stamp = Date.now();
  for (const [page, company] of [[a, 'Alpha Ltd'], [b, 'Beta Ltd']] as const) {
    await signUp(page, company, `${company.split(' ')[0].toLowerCase()}-${stamp}@example.com`);
  }
  const pdf = await (await a.request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await a.request.post('/api/agreements', { multipart: { file: { name: 'Alpha private.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  await b.goto('/');
  await expect(b.getByText('Beta Ltd')).toBeVisible();
  await expect(b.getByText('Your first agreement starts here')).toBeVisible();
  await expect(b.getByText('Alpha private')).toHaveCount(0);
  expect((await b.request.get(`/api/agreements/${agreement.id}`)).status()).toBe(404);
  await alpha.close();
  await beta.close();
});

test('a signer opens their link without any login', async ({ page, browser }) => {
  // Staff side, in its own browser context.
  const staff = await (await browser.newContext()).newPage();
  await signUp(staff, 'Link Co', `link-${Date.now()}@example.com`);
  const pdf = await (await staff.request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await staff.request.post('/api/agreements', { multipart: { file: { name: 'Link test.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  await staff.request.put(`/api/agreements/${agreement.id}/marks`, { data: { version: 0, marks: [{ id: 's', page: 2, x: .1, y: .55, width: .35, height: .08 }] } });
  const file = await (await staff.request.post('/api/files', { data: { title: 'Link job', client_name: 'Client', signer_name: 'Sam Lee', signer_email: 'sam@example.com', agreement_id: agreement.id } })).json();
  const sent = await (await staff.request.post(`/api/files/${file.id}/send`)).json();
  // The signer: a different browser with no account at all.
  await page.goto(sent.signing_path);
  await expect(page.getByRole('heading', { name: 'Link test' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toHaveCount(0);
});

test('forgot password: request a link, open it from the email, choose a new password', async ({ page }) => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const email = `forgot-${Date.now()}@example.com`;
  await page.request.post('/api/auth/signup', { data: { company: 'Forgot Co', name: 'Ana Lopez', email, password: PASSWORD } });  // not logged in

  await page.goto('/');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists for that email');

  // Read the emailed link from the test outbox.
  const outbox = process.env.ASTRA_E2E_OUTBOX!;
  // Other tests' emails (e.g. signing links) share the outbox: wait for one to this account.
  const toMe = () => readdirSync(outbox).filter(name => name.endsWith('.json')).sort()
    .map(name => JSON.parse(readFileSync(join(outbox, name), 'utf-8'))).filter(message => message.to === email);
  await expect.poll(() => toMe().length, { timeout: 10000 }).toBeGreaterThan(0);
  const mine = toMe().at(-1);
  expect(mine.subject).toBe('Reset your Astra Sign password');
  const link = /\/reset-password#[A-Za-z0-9_-]{43,}/.exec(mine.text)![0];

  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('a brand new passphrase');
  await page.getByLabel('Confirm new password', { exact: true }).fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Password reset' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your password has been reset. Log in with your new password.');
  await page.getByRole('link', { name: 'Go to log in' }).click();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Forgot Co')).toBeVisible();

  await page.goto(link);  // the link works only once
  await page.getByLabel('New password', { exact: true }).fill('another new passphrase');
  await page.getByLabel('Confirm new password', { exact: true }).fill('another new passphrase');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('alert')).toContainText('invalid or has expired');
});

test('delete the account from the account menu, after typing the confirmation', async ({ page }) => {
  const { email } = await signUp(page, 'Delete Me Co');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await page.request.post('/api/agreements', { multipart: { file: { name: 'Doomed.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  await page.goto('/');
  await expect(page.getByText('Delete Me Co')).toBeVisible();
  await page.getByRole('button', { name: /signed in as Pat Tester/i }).click();
  await page.getByRole('menuitem', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete Me Co');
  const confirm = dialog.getByRole('button', { name: 'Delete account permanently' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type “I want to delete account” to confirm').fill('I want to delete account');
  await page.screenshot({ path: 'test-results/delete-account.png', fullPage: true });
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your account has been deleted.');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  expect((await page.request.get(`/api/agreements/${agreement.id}`)).status()).toBe(401);
});

test('the account menu is reachable on a narrow screen', async ({ page }) => {
  await signUp(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /signed in as Pat Tester/i }).click();
  await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
});

