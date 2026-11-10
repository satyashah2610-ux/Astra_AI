import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers';

// Staff pages and APIs need a login: every test starts with a fresh company account.
test.beforeEach(async ({ page }) => { await signUp(page); });

async function drawBox(page: Page) {
  const overlay = page.getByTestId('pdf-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width * .12, box.y + box.height * .57);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .48, box.y + box.height * .65, { steps: 12 });
  await page.mouse.up();
}

test('the whole loop in the UI: prepare, create and send, client signs, staff downloads', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Staff prepare the agreement.
  await page.goto('/');
  const pdf = await page.request.get('/api/sample-agreement.pdf');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Loop agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() });
  await expect(page.getByRole('heading', { name: 'Loop agreement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await drawBox(page);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();

  // Staff create a file and send it.
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill('Loop job 001');
  await page.getByLabel('Client name').fill('Loop Client Ltd');
  await page.getByLabel('Signer name').fill('Riley Loop');
  await page.getByLabel('Signer email').fill('riley@example.com');
  await page.getByLabel('Agreement').selectOption({ label: 'Loop agreement' });
  await page.getByRole('button', { name: 'Create and send' }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Sent');
  const link = await page.getByLabel('Signing link').inputValue();
  expect(link).toMatch(/\/sign#[A-Za-z0-9_-]{43,}$/);
  await page.screenshot({ path: 'test-results/files-sent.png', fullPage: true });

  // The client signs in their own browser tab.
  const client = await context.newPage();
  await client.goto(link);
  await expect(client.getByRole('heading', { name: 'Loop agreement' })).toBeVisible();
  await expect(client.getByLabel('Full name')).toHaveValue('Riley Loop');
  await client.getByLabel(/I agree to sign this agreement electronically/).check();
  await client.getByRole('button', { name: 'Sign agreement' }).click();
  await expect(client.getByRole('heading', { name: /You’ve signed/ })).toBeVisible();
  await client.close();

  // Back on the staff page: the file is signed and the signed PDF downloads.
  await page.bringToFront();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Signed');
  const timeline = page.getByRole('list', { name: 'Timeline' });
  for (const label of ['Created', 'Sent', 'Opened by signer', 'Signed']) await expect(timeline).toContainText(label);
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download signed PDF' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Loop agreement - signed.pdf');
  expect(readFileSync((await download.path())!).subarray(0, 5).toString()).toBe('%PDF-');
  await page.screenshot({ path: 'test-results/files-signed.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('the Files screen works on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'New file' }).first().click();
  await expect(page.getByLabel('Signer email')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/files-mobile.png', fullPage: true });
});

test('the status filters fit on one line beside the file list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Files' }).click();
  const filters = page.getByRole('group', { name: 'Filter by status' }).getByRole('button');
  await expect(filters).toHaveText(['All', 'Draft', 'Sent', 'Viewed', 'Signed']);
  const group = (await page.getByRole('group', { name: 'Filter by status' }).boundingBox())!;
  const last = (await filters.last().boundingBox())!;
  const first = (await filters.first().boundingBox())!;
  expect(last.y).toBe(first.y);  // one row
  expect(last.x + last.width).toBeLessThanOrEqual(group.x + group.width + 0.5);  // and nothing spills past the column
});
