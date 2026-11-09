import { test, expect, type APIRequestContext } from '@playwright/test';

/** Staff side through the API: upload the sample, place one box on page 2, create a file and send it. */
async function sendFile(request: APIRequestContext, signer = 'Jordan Smith') {
  const pdf = await (await request.get('/api/sample-agreement.pdf')).body();
  const agreement = await (await request.post('/api/agreements', { multipart: { file: { name: 'Signing test agreement.pdf', mimeType: 'application/pdf', buffer: pdf } } })).json();
  const marks = [{ id: 'box-1', page: 2, x: .1, y: .55, width: .35, height: .08 }];
  expect((await request.put(`/api/agreements/${agreement.id}/marks`, { data: { version: 0, marks } })).ok()).toBe(true);
  const file = await (await request.post('/api/files', { data: { title: 'Browser signing test', client_name: 'Smith Family', signer_name: signer, signer_email: 'jordan@example.com', agreement_id: agreement.id } })).json();
  const sent = await (await request.post(`/api/files/${file.id}/send`)).json();
  return { fileId: file.id as string, path: sent.signing_path as string, agreement };
}

async function timeline(request: APIRequestContext, fileId: string) {
  return (await (await request.get(`/api/files/${fileId}/events`)).json()).map((event: { type: string }) => event.type);
}

test('a client opens the link, types a signature, consents and signs', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const { fileId, path, agreement } = await sendFile(request);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: agreement.name })).toBeVisible();
  await expect(page).toHaveTitle(`Sign ${agreement.name} — Astra Sign`);
  await expect(page.getByText(/Hi Jordan Smith/)).toBeVisible();
  await expect(page.getByTestId('signing-page')).toHaveCount(2);
  await expect(page.getByTestId('sign-here')).toHaveCount(1);
  await expect.poll(async () => (await (await request.get(`/api/files/${fileId}`)).json()).status).toBe('viewed');

  const sign = page.getByRole('button', { name: 'Sign agreement' });
  await expect(sign).toBeDisabled();
  await expect(page.getByLabel('Full name')).toHaveValue('Jordan Smith');
  await expect(page.getByLabel('Signature preview')).toContainText('Jordan Smith');
  await page.getByRole('button', { name: 'Go to signature box' }).click();
  await expect(page.getByTestId('sign-here')).toBeInViewport();
  await expect(page.getByTestId('sign-here').getByRole('img', { name: 'Your signature' })).toBeVisible();
  await page.getByLabel(/I agree to sign this agreement electronically/).check();
  await expect(sign).toBeEnabled();
  await page.screenshot({ path: 'test-results/signing-ready.png', fullPage: true });
  await sign.click();

  await expect(page.getByRole('heading', { name: `You’ve signed ${agreement.name}` })).toBeVisible();
  const file = await (await request.get(`/api/files/${fileId}`)).json();
  expect(file.status).toBe('signed');
  expect(await timeline(request, fileId)).toEqual(['created', 'sent', 'viewed', 'signed']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This agreement is already signed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign agreement' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a client draws a signature on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { fileId, path } = await sendFile(request, 'Alex Rivera');
  await page.goto(path);
  await page.getByRole('tab', { name: 'Draw' }).click();
  const sign = page.getByRole('button', { name: 'Sign agreement' });
  await page.getByLabel(/I agree to sign this agreement electronically/).check();
  const pad = page.getByTestId('signature-canvas');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(sign).toBeDisabled();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .25, { steps: 10 });
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7, { steps: 10 });
  await page.mouse.move(box.x + box.width * .85, box.y + box.height * .3, { steps: 10 });
  await page.mouse.up();
  await expect(sign).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/signing-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(sign).toBeDisabled();
  await page.mouse.move(box.x + box.width * .1, box.y + box.height * .6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .9, box.y + box.height * .4, { steps: 15 });
  await page.mouse.up();
  await sign.click();
  await expect(page.getByRole('heading', { name: /You’ve signed/ })).toBeVisible();
  expect((await (await request.get(`/api/files/${fileId}`)).json()).status).toBe('signed');
});

test('an invalid or replaced link explains what to do', async ({ page, request }) => {
  const { fileId, path } = await sendFile(request);
  await request.post(`/api/files/${fileId}/link`);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();
  await expect(page.getByText(/Ask the sender for a new link/)).toBeVisible();
  await page.goto('/sign#not-a-real-token-at-all-0000000000');  // same page, new fragment: must still re-check
  await expect(page.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();
});
