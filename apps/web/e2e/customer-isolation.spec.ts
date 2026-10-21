import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Data isolation in the dashboard (M5.13): Bob has a business, a support ticket and an application; Alice,
 * signed in on her own account, opens Bob's application by its URL and browses her dashboard pages — she
 * sees "not found" and none of Bob's things. Runs on desktop and mobile. The API-side checks for every
 * customer route are in apps/api/test/data-isolation.e2e-spec.ts.
 * Requires the API in development mode (dev OTP codes) with seeded data.
 */

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

async function registerBob(request: APIRequestContext, stamp: string) {
  const res = await request.post(`${apiUrl}/api/auth/register`, {
    data: { name: 'Bob Isolation', mobile: `8${stamp}`.slice(0, 10), email: `pw-iso-bob-${stamp}@example.com`, password: 'secret1234', consent: true },
  });
  expect(res.status()).toBe(201);
  return { Authorization: `Bearer ${(await res.json()).accessToken}` };
}

test('a customer cannot see another customer’s application, business or ticket', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const stamp = `${Date.now()}`.slice(-8) + (info.project.name === 'mobile' ? '1' : '2');
  const bob = await registerBob(request, stamp);
  const bobBusiness = `Bob Hidden Traders ${stamp}`;
  const bobTicket = `Bob hidden ticket ${stamp}`;

  const entity = await request.post(`${apiUrl}/api/business-entities`, { headers: bob, data: { legalName: bobBusiness, entityType: 'PROPRIETORSHIP' } });
  expect(entity.status()).toBe(201);
  const service = await request.get(`${apiUrl}/api/catalogue/services/gst-registration`);
  expect(service.status()).toBe(200);
  const packageId = (await service.json()).packages[0].id as string;
  const started = await request.post(`${apiUrl}/api/applications`, { headers: bob, data: { packageId, businessEntityId: (await entity.json()).id } });
  expect(started.ok()).toBe(true);
  const bobApp = (await started.json()) as { id: string; code: string };
  const ticket = await request.post(`${apiUrl}/api/tickets`, { headers: bob, data: { subject: bobTicket, description: 'Only Bob should ever read this.' } });
  expect(ticket.status()).toBe(201);

  // Alice signs up in the browser.
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Alice Isolation');
  await page.getByLabel('Mobile number').fill(`9${stamp}`.slice(0, 10));
  await page.getByLabel('Email').fill(`pw-iso-alice-${stamp}@example.com`);
  await page.getByLabel('Password').fill('secret1234');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
  const code = await page.locator('text=Development mode: your code is').locator('span').innerText();
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Bob's application by its URL: not found, and nothing of it on the page.
  await page.goto(`/dashboard/applications/${bobApp.id}`);
  await expect(page.getByText('Application not found')).toBeVisible();
  await expect(page.getByText(bobApp.code)).toHaveCount(0);
  await expect(page.getByText(bobBusiness)).toHaveCount(0);

  // Her own pages list none of Bob's things.
  for (const [path, heading] of [
    ['/dashboard/services', /My Services/],
    ['/dashboard/businesses', /business/i],
    ['/dashboard/support', /Support/],
  ] as const) {
    await page.goto(path); // NOSONAR: tests run steps in order
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible(); // NOSONAR: tests run steps in order
    await expect(page.getByText(bobApp.code)).toHaveCount(0); // NOSONAR: tests run steps in order
    await expect(page.getByText(bobBusiness)).toHaveCount(0); // NOSONAR: tests run steps in order
    await expect(page.getByText(bobTicket)).toHaveCount(0); // NOSONAR: tests run steps in order
  }
});
