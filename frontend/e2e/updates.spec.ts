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
  await client.getByRole('region', { name: /^Page 2 of/ }).hover();
  await client.mouse.wheel(0, -20000);  // scrolling back to the top: the page box follows
  await expect(clientJump).toHaveValue('1');
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

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the signing page: the page box sits beside the tools, and a long name fits the signature preview', async ({ page, context }) => {
  await page.goto('/');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Layout check.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();

  // Staff: adopting a signature in the narrow side panel keeps both buttons inside it.
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const adopt = page.getByRole('region', { name: 'Adopt your signature' });
  const panel = (await adopt.boundingBox())!;
  for (const name of ['Cancel', 'Place on the page']) {
    const button = (await adopt.getByRole('button', { name }).boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(panel.x - 1);
    expect(button.x + button.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  await adopt.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Add signature box for client' }).click();
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill('Layout job');
  await page.getByLabel('Client name').fill('Layout Client');
  await page.getByLabel('Signer name').fill('Riley Quinn');
  await page.getByLabel('Signer email').fill('riley@example.com');
  await page.getByLabel('Agreement').selectOption({ label: 'Layout check' });
  await page.getByRole('button', { name: 'Create and send' }).click();
  await page.getByRole('dialog', { name: 'Check the details before sending' }).getByRole('button', { name: 'Confirm and send' }).click();
  const link = await page.getByLabel('Signing link').inputValue();

  const client = await context.newPage();
  await client.goto(link);
  await expect(client.getByRole('region', { name: /^Page 1 of/ })).toBeVisible();
  const jump = (await client.getByRole('spinbutton', { name: 'Go to page' }).boundingBox())!;
  const tops = new Set<number>();
  for (const button of await client.getByRole('toolbar', { name: 'Add to the document' }).getByRole('button').all()) {
    const place = (await button.boundingBox())!;
    expect(overlaps(jump, place)).toBe(false);
    tops.add(Math.round(place.y));
  }
  expect(tops.size).toBe(1);  // every tool, Signature included, on one line

  await client.getByLabel('Full name').fill('Satya Shah Venkataraman Subramaniam');
  const preview = client.getByLabel('Signature preview');
  const box = (await preview.boundingBox())!;
  const text = (await preview.locator('span').boundingBox())!;
  expect(text.x).toBeGreaterThanOrEqual(box.x);
  expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width);
});
