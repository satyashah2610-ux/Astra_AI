import { test, expect, type Page } from '@playwright/test';
import { signUp } from './helpers';

// The parts of a file's life the other specs don't walk through: drafts, edits, search and filters,
// reissuing a link (the old one stops, the new one opens and is recorded), and deleting a file.
test.beforeEach(async ({ page }) => { await signUp(page); });

async function agreementWithBox(page: Page, name: string) {
  await page.goto('/');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  await page.getByLabel('Upload PDF file').setInputFiles({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Add signature box for client' }).click();
  await page.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect(page.getByText('All changes saved')).toBeVisible();
}

async function draft(page: Page, title: string, client: string, agreement: string) {
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('File name or reference').fill(title);
  await page.getByLabel('Client name').fill(client);
  await page.getByLabel('Signer name').fill(`${client} Signer`);
  await page.getByLabel('Signer email').fill('signer@example.com');
  await page.getByLabel('Agreement').selectOption({ label: agreement });
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Draft');
}

const opens = (page: Page) => page.getByRole('list', { name: 'Timeline' }).getByText('Opened by signer', { exact: true });

test('draft, edit, search, filter, send, reissue and delete a file', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await agreementWithBox(page, 'Lifecycle agreement');
  await page.getByRole('tab', { name: 'Files' }).click();

  // Without the email, the reminders and the personal message are greyed out.
  await page.getByRole('button', { name: 'New file' }).first().click();
  await page.getByLabel('Email the link to the signer').uncheck();
  await expect(page.getByLabel('Personal message (optional)')).toBeDisabled();
  await expect(page.getByLabel('Remind them every day for up to 7 days if it isn’t signed')).toBeDisabled();
  await page.getByLabel('Email the link to the signer').check();
  await expect(page.getByLabel('Personal message (optional)')).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await draft(page, 'Kitchen job', 'Harbor Homes', 'Lifecycle agreement');
  await draft(page, 'Garden job', 'Cedar Yard', 'Lifecycle agreement');

  // Edit a draft: the change is saved and shown.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Client name').fill('Cedar Yard Co');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.file-facts')).toContainText('Cedar Yard Co');

  // Search and the status filters narrow the list.
  const list = page.getByRole('list', { name: 'Files' });
  await page.getByLabel('Search files').fill('harbor');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Kitchen job');
  await page.getByLabel('Search files').fill('');
  await expect(list.getByRole('button')).toHaveCount(2);

  // Send the kitchen job without email, after checking the details.
  await list.getByRole('button', { name: /Kitchen job/ }).click();
  await page.getByLabel('Email the link to the signer').uncheck();
  await expect(page.getByLabel('Remind them every day for up to 7 days if it isn’t signed')).toBeDisabled();  // no email, no reminders
  await page.getByRole('button', { name: 'Send for signature' }).click();
  const check = page.getByRole('dialog', { name: 'Check the details before sending' });
  await expect(check).toContainText('No, you will share the link yourself');
  await check.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Sent');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Link created, not emailed');
  await expect(page.getByRole('list', { name: 'Timeline' })).not.toContainText('Sent by email');
  const first = await page.getByLabel('Signing link').inputValue();
  const filters = page.getByRole('group', { name: 'Filter by status' });
  await filters.getByRole('button', { name: 'Draft' }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Garden job');
  await filters.getByRole('button', { name: 'All' }).click();

  // The client opens the first link: recorded once, however often it's reloaded.
  const client = await context.newPage();
  client.on('pageerror', error => errors.push(error.message));
  await client.goto(first);
  await expect(client.getByRole('button', { name: 'Sign agreement' })).toBeVisible();
  await client.reload();
  await expect(client.getByRole('button', { name: 'Sign agreement' })).toBeVisible();
  await page.bringToFront();
  await list.getByRole('button', { name: /Kitchen job/ }).click();
  await expect(page.getByTestId('file-status')).toHaveText('Viewed', { timeout: 15000 });
  await expect(opens(page)).toHaveCount(1);

  // Reissue: the old link stops working, the new one opens and is recorded too.
  await page.getByRole('button', { name: 'Reissue link' }).click();
  const reissue = page.getByRole('dialog', { name: 'Make a new signing link?' });
  await reissue.getByLabel('Email the new link to the signer').uncheck();
  await reissue.getByRole('button', { name: 'Make a new link' }).click();
  await expect(reissue).toBeHidden();
  await expect(page.getByLabel('Signing link')).not.toHaveValue(first);  // wait for the new link to replace the old
  const second = await page.getByLabel('Signing link').inputValue();
  await client.goto('about:blank');
  await client.goto(first);
  await expect(client.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();
  await client.goto('about:blank');
  await client.goto(second);
  await expect(client.getByRole('button', { name: 'Sign agreement' })).toBeVisible();
  await page.bringToFront();
  await expect(opens(page)).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Link reissued');

  // Delete: the file goes, and its link stops working.
  await page.getByRole('button', { name: 'Delete file' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).not.toContainText('Kitchen job');
  await page.reload();
  await expect(page.getByRole('list', { name: 'Files' }).getByRole('button')).toHaveCount(1);
  await client.goto('about:blank');
  await client.goto(second);
  await expect(client.getByRole('heading', { name: 'This link isn’t valid' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('agreements can be found by name', async ({ page }) => {
  await page.goto('/');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  for (const name of ['Roofing terms', 'Plumbing terms']) {
    await page.getByLabel('Upload PDF file').setInputFiles({ name: `${name}.pdf`, mimeType: 'application/pdf', buffer: pdf });
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();  // one upload at a time, as a person would
  }
  const library = page.getByLabel('Agreement library');
  await expect(library.getByRole('button')).toHaveCount(2);
  await page.getByLabel('Search agreements').fill('roof');
  await expect(library.getByRole('button')).toHaveCount(1);
  await expect(library).toContainText('Roofing terms');
  await page.getByLabel('Search agreements').fill('nothing like this');
  await expect(library).toContainText('No matching agreements.');
});

test('staff sign with the name they type, starting from their sign-up name', async ({ page }) => {
  await page.goto('/');
  const pdf = await (await page.request.get('/api/sample-agreement.pdf')).body();
  await page.getByLabel('Upload PDF file').setInputFiles({ name: 'Own name.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.getByTestId('pdf-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Signature', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Your full name' });
  await expect(name).toHaveValue('Pat Tester');  // the sign-up name
  await name.fill('Satya Shah');
  await expect(page.getByLabel('Signature preview')).toContainText('Satya Shah');
  await page.getByRole('button', { name: 'Place on the page' }).click();
  await expect(page.getByTestId('company-field')).toHaveCount(1);
  await page.getByRole('button', { name: 'Initials', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your full name' })).toHaveValue('Satya Shah');  // kept for the initials
  await expect(page.getByLabel('Initials preview')).toContainText('SS');
});
