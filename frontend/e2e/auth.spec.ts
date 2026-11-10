import { test, expect } from '@playwright/test';
import { PASSWORD } from './helpers';

test('create a company account, log out, log back in', async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await page.screenshot({ path: 'test-results/auth-login.png', fullPage: true });
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Company name').fill('Riverside Builders');
  await page.getByLabel('Your name').fill('Ana Lopez');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Riverside Builders')).toBeVisible();
  await expect(page.getByLabel('Signed in as Ana Lopez')).toHaveText('AL');

  await page.reload();  // the session survives a reload
  await expect(page.getByText('Riverside Builders')).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await page.getByLabel('Password').fill(PASSWORD);
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
    const response = await page.request.post('/api/auth/signup', { data: { company, name: 'Pat Tester', email: `${company.split(' ')[0].toLowerCase()}-${stamp}@example.com`, password: PASSWORD } });
    expect(response.status()).toBe(201);
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
  await staff.request.post('/api/auth/signup', { data: { company: 'Link Co', name: 'Pat Tester', email: `link-${Date.now()}@example.com`, password: PASSWORD } });
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
