import { test, expect } from '@playwright/test';

test('a visitor sees the landing page, watches the timeline demo, and goes on to create an account', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Send the agreement. Watch it get signed.');
  const demo = page.getByRole('region', { name: 'Product demo: one file from draft to signed' });
  await expect(demo.getByText('Opened by signer')).toBeVisible({ timeout: 15_000 });
  await expect(demo.getByTestId('demo-status')).toHaveText('Signed', { timeout: 15_000 });
  await page.screenshot({ path: 'test-results/landing.png', fullPage: true });

  await page.getByRole('link', { name: /Start free/ }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Create your company account' })).toBeVisible();
});

test('Log in on the landing page opens the login form', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Log in' }).first().click();
  await expect(page.getByRole('heading', { name: 'Log in to Astra Sign' })).toBeVisible();
});

test('section links in the header scroll on the first click', async ({ page }) => {
  await page.goto('/');
  for (const [name, id] of [['Features', 'features'], ['How it works', 'how'], ['Security', 'security']]) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name }).click();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
  expect(new URL(page.url()).hash).toBe('');
});
