import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'correct horse battery staple';
let counter = 0;

/** Create a fresh company account and log the page's browser in (page.request shares the browser's cookies). */
export async function signUp(page: Page, company = 'Browser Test Co', email = `staff-${Date.now()}-${process.pid}-${++counter}@example.com`) {
  const response = await page.request.post('/api/auth/signup', { data: { company, name: 'Pat Tester', email, password: PASSWORD } });
  expect(response.status()).toBe(201);
  expect((await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })).status()).toBe(200);  // sign-up alone doesn't log in
  return { email, company };
}
