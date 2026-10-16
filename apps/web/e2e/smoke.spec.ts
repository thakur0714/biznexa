import { expect, test } from '@playwright/test';

/** Core journeys for Milestones 1–2. Requires the seeded demo data and the API in development mode (OTP shown on screen). */

test('homepage search finds a service despite a typo and opens its page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Everything your business needs/);
  await page.getByRole('combobox', { name: /What service are you looking for/ }).fill('trademrk');
  const option = page.getByRole('option', { name: /Trademark Registration/ }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/services\/trademark\/trademark-registration$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trademark Registration');
});

test('service page shows packages and updates the total when switching package', async ({ page, isMobile }) => {
  await page.goto('/services/tax-gst/gst-registration');
  const card = page.getByRole('complementary', { name: 'Price and packages' });
  await card.getByRole('radio', { name: /Basic/ }).check();
  const totalBasic = await card.locator('dt:text("Total payable") + dd').innerText();
  await card.getByRole('radio', { name: /Premium/ }).check();
  const totalPremium = await card.locator('dt:text("Total payable") + dd').innerText();
  expect(totalBasic).not.toEqual(totalPremium);
  await expect(page.getByRole('heading', { name: 'Documents required' })).toBeVisible();
  if (isMobile) await expect(page.getByRole('link', { name: 'Get started' }).last()).toBeVisible();
});

test('category filters narrow the list', async ({ page }) => {
  await page.goto('/services/tax-gst');
  await expect(page.getByText('12 services')).toBeVisible();
  await page.getByRole('radio', { name: 'Income Tax' }).check();
  await expect(page).toHaveURL(/subcategory=income-tax/);
  await expect(page.getByText('5 services')).toBeVisible();
});

test('certificate verification shows active, suspended and not-found states', async ({ page }) => {
  await page.goto('/verify');
  await page.getByRole('radio', { name: 'Verification ID' }).click();
  await page.getByLabel('Verification ID').fill('demq9001actv');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Certificate verified' })).toBeVisible();

  await page.goto('/verify?number=BNC-DEMO-000003');
  await expect(page.getByRole('heading', { name: /currently suspended/ })).toBeVisible();

  await page.goto('/verify?number=NOT-A-REAL-NUMBER');
  await expect(page.getByRole('heading', { name: /No certificate found/ })).toBeVisible();
});

test('a new customer registers, verifies the mobile number and lands on the dashboard', async ({ page }, info) => {
  const stamp = `${Date.now()}`.slice(-8) + (info.project.name === 'mobile' ? '1' : '2');
  const mobile = `7${stamp}`.slice(0, 10);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Playwright Customer');
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByLabel('Email').fill(`pw-${stamp}@example.com`);
  await page.getByLabel('Password').fill('secret1234');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Verify your mobile number' })).toBeVisible();
  const code = await page.locator('text=Development mode: your code is').locator('span').innerText();
  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify code' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Hello, Playwright' })).toBeVisible();
  await expect(page.getByText('· verified').last()).toBeVisible();

  // session survives a reload (refresh-token cookie)
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Playwright' })).toBeVisible();

  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test('Get started sends a visitor through login and back to the chosen package', async ({ page }) => {
  await page.goto('/services/trademark/trademark-registration');
  await page.getByRole('complementary', { name: 'Price and packages' }).getByRole('link', { name: 'Get started' }).first().click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Email').fill('customer@biznexa.local');
  await page.getByLabel('Password').fill('Customer@12345');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/apply\/trademark-registration\?package=/);
  await expect(page.getByRole('heading', { name: 'Start your application' })).toBeVisible();
  await expect(page.getByText('Order summary')).toBeVisible();
});

test('wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('customer@biznexa.local');
  await page.getByLabel('Password').fill('nope-nope1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Incorrect' }).first()).toHaveText('Incorrect email or password');
});
