import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { signUp } from './helpers';

// Staff pages and APIs need a login: every test starts with a fresh company account.
test.beforeEach(async ({ page }) => { await signUp(page); });

/** Tap a point given as fractions of an element's box. */
async function tapAt(page: Page, target: Locator, x: number, y: number) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

test('staff add text and a comment; the client places ticks, dots, text, name, date and initials and signs', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // Staff: a template with company text, a comment and a signature box, made in the editor.
  await page.goto('/');
  const pdf = await page.request.get('/api/sample-agreement.pdf');
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Items agreement.pdf', mimeType: 'application/pdf', buffer: await pdf.body() });
  await expect(page.getByRole('heading', { name: 'Items agreement', exact: true })).toBeVisible();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Add text' }).click();
  const printed = page.getByLabel('Text printed on the document');
  await printed.fill('Project: Riverside fit-out');
  await expect(page.getByTestId('text-field')).toContainText('Project: Riverside fit-out');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.getByLabel('Comment for the client').fill('Tick the plan you want');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Add signature box for client' }).click();
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await expect(page.getByText('1 signature field')).toBeVisible();
  await page.screenshot({ path: 'test-results/items-editor.png', fullPage: true });

  // Staff: create and send.
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill('Items job');
  await page.getByLabel('Client name').fill('Items Client');
  await page.getByLabel('Signer name').fill('Riley Quinn');
  await page.getByLabel('Signer email').fill('riley@example.com');
  await page.getByLabel('Agreement').selectOption({ label: 'Items agreement' });
  await page.getByRole('button', { name: 'Create and send' }).click();
  await page.getByRole('button', { name: 'Confirm and send' }).click();  // after checking the details
  const link = await page.getByLabel('Signing link').inputValue();

  // Client: sees the comment, places items on page 1, signs.
  const client = await context.newPage();
  client.on('pageerror', error => errors.push(error.message));
  await client.goto(link);
  await expect(client.getByRole('heading', { name: 'Items agreement' })).toBeVisible();
  await expect(client.getByLabel('Note from the sender')).toContainText('Tick the plan you want');
  const firstPage = client.getByTestId('signer-layer-1');
  await expect(firstPage).toBeVisible();

  await client.getByRole('button', { name: 'Tick', exact: true }).click();
  await tapAt(client, firstPage, .2, .45);
  const tick = client.getByRole('button', { name: 'Tick on page 1' });
  await expect(tick).toBeVisible();
  const layerBox = (await firstPage.boundingBox())!;
  const tickBox = (await tick.boundingBox())!;
  expect(Math.abs(tickBox.x + tickBox.width / 2 - (layerBox.x + layerBox.width * .2))).toBeLessThan(3);  // lands where tapped

  await client.getByRole('button', { name: 'Dot', exact: true }).click();
  await tapAt(client, firstPage, .2, .5);
  await client.getByRole('button', { name: 'Text', exact: true }).click();
  await tapAt(client, firstPage, .5, .55);
  await client.keyboard.type('Unit 4B, Riverside');  // the cursor is already in the new text box
  await client.getByRole('button', { name: 'Name', exact: true }).click();
  await tapAt(client, firstPage, .5, .6);
  await expect(client.getByRole('button', { name: 'Name on page 1' })).toContainText('Riley Quinn');
  await client.getByRole('button', { name: 'Date', exact: true }).click();
  await tapAt(client, firstPage, .5, .65);
  await client.getByRole('button', { name: 'Initials', exact: true }).click();
  await tapAt(client, firstPage, .9, .92);

  // Drag the dot a little to the right, then remove and re-add nothing: it must still be one dot.
  const dot = client.getByRole('button', { name: 'Dot on page 1' });
  const dotBox = (await dot.boundingBox())!;
  await client.mouse.move(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2);
  await client.mouse.down();
  await client.mouse.move(dotBox.x + dotBox.width / 2 + 40, dotBox.y + dotBox.height / 2, { steps: 6 });
  await client.mouse.up();
  expect((await dot.boundingBox())!.x).toBeGreaterThan(dotBox.x + 30);
  await expect(client.getByRole('button', { name: 'Dot on page 1' })).toHaveCount(1);

  await client.getByLabel(/I agree to sign this agreement electronically/).check();
  const sign = client.getByRole('button', { name: 'Sign agreement' });
  await expect(sign).toBeEnabled();  // typed initials are adopted automatically from the name
  await client.screenshot({ path: 'test-results/items-signing.png', fullPage: true });
  const signed = client.waitForResponse(response => response.url().endsWith('/api/signing/sign'));
  await sign.click();
  const body = (await signed).request().postDataJSON();
  expect(body.items.map((item: { type: string }) => item.type)).toEqual(['check', 'dot', 'text', 'name', 'date', 'initials']);
  await expect(client.getByRole('heading', { name: /You’ve signed/ })).toBeVisible();
  const downloading = client.waitForEvent('download');
  await client.getByRole('button', { name: 'Download signed copy' }).click();
  expect(readFileSync((await (await downloading).path())!).subarray(0, 5).toString()).toBe('%PDF-');
  expect(errors).toEqual([]);
});

test('on a phone the page still scrolls when no tool is picked, and a tap places an item', async ({ page }) => {
  const request = page.request;
  await page.setViewportSize({ width: 390, height: 844 });
  const pdf = await (await request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await request.post('/api/agreements', { multipart: { file: { name: 'Phone items.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  await request.put(`/api/agreements/${agreement.id}/marks`, { data: { version: 0, marks: [{ id: 's', page: 2, x: .1, y: .55, width: .35, height: .08 }] } });
  const file = await (await request.post('/api/files', { data: { title: 'Phone', client_name: 'Phone Co', signer_name: 'Sam Lee', signer_email: 'sam@example.com', agreement_id: agreement.id } })).json();
  const sent = await (await request.post(`/api/files/${file.id}/send`)).json();
  await page.goto(sent.signing_path);
  const layer = page.getByTestId('signer-layer-1');
  await expect(layer).toBeVisible();
  expect(await layer.evaluate(element => getComputedStyle(element).touchAction)).toBe('auto');  // scrolling with a finger works
  await page.getByRole('button', { name: 'Tick', exact: true }).click();
  expect(await layer.evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
  await tapAt(page, layer, .3, .3);
  await expect(page.getByRole('button', { name: 'Tick on page 1' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/items-mobile.png', fullPage: true });
});
