import { test, expect } from '@playwright/test';
import { signUp } from './helpers';

// Staff pages and APIs need a login: every test starts with a fresh company account.
test.beforeEach(async ({ page }) => { await signUp(page); });

test('the company signs its side, checks the details, and watches the client sign without refreshing', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Staff: the client's box plus the company's own tick, date and signature.
  await page.goto('/');
  const pdf = await page.request.get('/api/sample-agreement.pdf');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Countersigned agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() });
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  const jump = page.getByRole('spinbutton', { name: 'Go to page' });
  await jump.fill('2');
  await jump.press('Enter');
  await expect(page.getByLabel('PDF page 2')).toBeVisible();
  await page.getByRole('button', { name: 'Add signature box for client' }).click();
  await page.getByRole('button', { name: 'Tick', exact: true }).click();
  await page.getByRole('button', { name: 'Date', exact: true }).click();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  await expect(page.getByLabel('Signature preview')).toContainText('Pat Tester');
  await page.getByRole('button', { name: 'Place on the page' }).click();
  await expect(page.getByTestId('company-field')).toHaveCount(3);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  // A refresh stays on Files.
  await page.getByRole('tab', { name: 'Files' }).click();
  await expect(page).toHaveURL(/\/files$/);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');

  // Create and send: every detail is shown before anything is sent.
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill('Countersigned job');
  await page.getByLabel('Client name').fill('Morgan Client');
  await page.getByLabel('Signer name').fill('Riley Quinn');
  await page.getByLabel('Signer email').fill('riley@example.com');
  await page.getByLabel('Agreement').selectOption({ label: 'Countersigned agreement' });
  await page.getByRole('button', { name: 'Create and send' }).click();
  const check = page.getByRole('dialog', { name: 'Check the details before sending' });
  await expect(check).toContainText('riley@example.com');
  await expect(check).toContainText('Countersigned agreement');
  await check.getByRole('button', { name: 'Confirm and send' }).click();
  const link = await page.getByLabel('Signing link').inputValue();
  await expect(page.getByTestId('file-status')).toHaveText('Sent');

  // Client: jumps to page 2 and signs.
  const client = await context.newPage();
  client.on('pageerror', error => errors.push(error.message));
  await client.goto(link);
  const clientJump = client.getByRole('spinbutton', { name: 'Go to page' });
  await clientJump.fill('2');
  await clientJump.press('Enter');
  await expect(client.getByRole('region', { name: /^Page 2 of/ })).toBeInViewport();
  await client.getByRole('button', { name: 'Go to signature box' }).click();
  await expect(client.getByTestId('sign-here')).toBeInViewport();
  await client.getByLabel(/I agree to sign this agreement electronically/).check();
  await client.getByRole('button', { name: 'Sign agreement' }).click();
  await expect(client.getByRole('heading', { name: /You’ve signed/ })).toBeVisible();

  // Staff: the status and timeline catch up by themselves, no refresh.
  await page.bringToFront();
  await expect(page.getByTestId('file-status')).toHaveText('Signed', { timeout: 15000 });
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Signed', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('an agreement can be renamed; a taken name gets a number', async ({ page }) => {
  await page.goto('/');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Services.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByRole('heading', { name: 'Services', exact: true })).toBeVisible();
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Other.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByRole('heading', { name: 'Other', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rename agreement' }).click();
  await page.getByRole('textbox', { name: 'Agreement name' }).fill('Services');
  await page.getByRole('textbox', { name: 'Agreement name' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Services (1)', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Agreement library')).toContainText('Services (1)');
});
