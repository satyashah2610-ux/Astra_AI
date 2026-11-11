import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers';

// Staff pages and APIs need a login: every test starts with a fresh company account.
test.beforeEach(async ({ page }) => { await signUp(page); });

async function draw(page: Page, start = { x: .12, y: .57 }, end = { x: .48, y: .65 }) {
  const overlay = page.getByTestId('pdf-overlay');
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await page.mouse.move(box.x + box.width * start.x, box.y + box.height * start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * end.x, box.y + box.height * end.y, { steps: 12 });
  await page.mouse.up();
}

test('real PDF upload, draw, move, resize, save, reopen and remove', async ({ page }) => {
  const request = page.request;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const pdf = await request.get('/api/sample-agreement.pdf');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Browser test agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() });
  await expect(page.getByRole('heading', { name: 'Browser test agreement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await draw(page);
  const field = page.getByTestId('signature-field');
  await expect(field).toHaveCount(1);
  const initial = (await field.boundingBox())!;
  await page.mouse.move(initial.x + 20, initial.y + 15);
  await page.mouse.down();
  await page.mouse.move(initial.x + 55, initial.y + 40, { steps: 8 });
  await page.mouse.up();
  const moved = (await field.boundingBox())!;
  expect(moved.x).toBeGreaterThan(initial.x + 25);
  await expect(field).toHaveCount(1);
  await page.getByRole('button', { name: 'Resize signature field' }).scrollIntoViewIfNeeded();
  const handle = (await page.getByRole('button', { name: 'Resize signature field' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 35, handle.y + 20, { steps: 8 });
  await page.mouse.up();
  const resized = (await field.boundingBox())!;
  expect(resized.width).toBeGreaterThan(moved.width + 20);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(field).toBeVisible();
  const reopened = (await field.boundingBox())!;
  expect(Math.abs(reopened.width - resized.width)).toBeLessThan(2);
  const beforeZoom = await field.getAttribute('style');
  await page.getByLabel('PDF zoom').selectOption('1.25');
  await expect(field).toBeVisible();
  expect(await field.getAttribute('style')).toBe(beforeZoom);
  await page.getByLabel('PDF zoom').selectOption('1');
  await expect(field).toBeVisible();
  await field.click();
  await page.screenshot({ path: 'test-results/agreement-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove field' }).click();
  await expect(field).toHaveCount(0);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 signature fields')).toBeVisible();
  expect(errors).toEqual([]);
});

test('sample button, unsaved-change guard, multiple pages, keyboard and mobile layout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample agreement', exact: true }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select and move fields' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw signature', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add signature box for client', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Add signature box for client', exact: true }).click();
  const field = page.getByTestId('signature-field');
  await expect(field).toBeFocused();  // a newly added box takes keyboard focus
  const before = (await field.boundingBox())!;
  await page.keyboard.press('ArrowRight');
  expect((await field.boundingBox())!.x).toBeGreaterThan(before.x);
  await page.getByTestId('pdf-overlay').click({ position: { x: 5, y: 5 } });  // deselect
  await field.click();  // clicking a box, like a user, must also give it keyboard focus
  await expect(field).toBeFocused();
  const clicked = (await field.boundingBox())!;
  await page.keyboard.press('ArrowDown');
  expect((await field.boundingBox())!.y).toBeGreaterThan(clicked.y);
  await expect(page.getByText('Width', { exact: true })).toHaveCount(0);  // exact: the zoom menu has "Fit width"
  await page.getByRole('tab', { name: 'Files' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await draw(page);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('2 signature fields')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.screenshot({ path: 'test-results/agreement-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a malformed PDF displays an actionable error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toContainText('valid PDF');
});

test('draws consecutive boxes and selects an existing box without changing tools', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample agreement', exact: true }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await draw(page, { x: .1, y: .2 }, { x: .4, y: .28 });
  await draw(page, { x: .5, y: .4 }, { x: .8, y: .48 });
  await expect(page.getByTestId('signature-field')).toHaveCount(2);
  await page.getByTestId('signature-field').first().click();
  await expect(page.getByRole('button', { name: 'Resize signature field' })).toBeVisible();
  const overlay = page.getByTestId('pdf-overlay');
  await overlay.click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('signature-field')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Resize signature field' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
});

test('Astra Sign branding and confirmed deletion persist after reload', async ({ page }) => {
  const request = page.request;
  await page.goto('/');
  await expect(page).toHaveTitle('Astra Sign — Agreements');
  await expect(page.getByRole('link', { name: 'Astra Sign', exact: true })).toBeVisible();  // the logo only
  const pdf = await request.get('/api/sample-agreement.pdf');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Delete this test agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() });
  await expect(page.getByRole('heading', { name: 'Delete this test agreement', exact: true })).toBeVisible();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Add signature box for client', exact: true }).click();
  await page.getByRole('button', { name: 'Delete agreement', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Delete this test agreement');
  await expect(page.getByRole('dialog')).toContainText('unsaved changes');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('signature-field')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete agreement', exact: true }).click();
  await page.screenshot({ path: 'test-results/delete-confirmation.png', fullPage: true });
  const deleted = page.waitForResponse(response => response.request().method() === 'DELETE' && response.status() === 204);
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  const response = await deleted;
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Delete this test agreement 2 pages/ })).toHaveCount(0);
  expect((await request.get(`${response.url()}/pdf`)).status()).toBe(404);
  await page.reload();
  await expect(page.getByRole('button', { name: /Delete this test agreement 2 pages/ })).toHaveCount(0);
});

test('duplicate uploads show numbered names in the library and editor after reload', async ({ page }) => {
  const request = page.request;
  await page.goto('/');
  const pdf = await request.get('/api/sample-agreement.pdf');
  const file = { name: 'Repeated agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() };
  for (const name of ['Repeated agreement', 'Repeated agreement (1)', 'Repeated agreement (2)']) {
    await page.getByLabel('Upload PDF file').setInputFiles(file);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.reload();
  for (const name of ['Repeated agreement', 'Repeated agreement (1)', 'Repeated agreement (2)']) {
    await page.getByRole('button', { name: `${name} 2 pages No signature box yet`, exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'test-results/duplicate-agreements.png', fullPage: true });
});
