import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Full order journey (M3.24): mobile OTP login → package → form → PDF upload → coupon → mock payment,
 * completed through the mock checkout endpoint → success view and customer-visible refund.
 * Requires the API in development mode with the mock gateway (no Razorpay keys), seeded data, and the
 * database on this machine (an admin is created per run with the create-admin script).
 */

function base32Decode(input: string): Buffer {
  const clean = input.replaceAll(/[\s=-]/g, '').toUpperCase();
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCode(secret: string, step = Math.floor(Date.now() / 1000 / 30)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac.at(-1)! & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1000000).padStart(6, '0');
}

test('full order journey covers payment success and a customer-visible refund', async ({ page, request }) => {
  test.setTimeout(120_000);
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const runId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
  const couponCode = `PWCOUPON${runId}`;

  // 1. Create a coupon via the admin API. Staff routes need 2FA and the seeded admin must not be
  //    changed, so each run creates its own admin with the existing create-admin script.
  const adminEmail = `pw-admin-${runId}@example.com`;
  const adminPassword = 'Playwright@12345'; // NOSONAR: test credential
  execFileSync('pnpm', ['--filter', '@biznexa/api', 'create-admin'], { // NOSONAR: dev tool from PATH
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, ADMIN_NAME: 'Playwright Admin', ADMIN_EMAIL: adminEmail, ADMIN_MOBILE: `6${runId.padStart(9, '0').slice(-9)}`, ADMIN_PASSWORD: adminPassword },
    stdio: 'pipe',
  });
  const loginRes = await request.post(`${apiUrl}/api/auth/login`, { data: { email: adminEmail, password: adminPassword } });
  expect(loginRes.status()).toBe(200);
  const auth = { Authorization: `Bearer ${(await loginRes.json()).accessToken}` };
  const setupRes = await request.post(`${apiUrl}/api/auth/2fa/setup`, { headers: auth });
  expect(setupRes.status()).toBe(200);
  const { secret } = await setupRes.json();
  const enableRes = await request.post(`${apiUrl}/api/auth/2fa/enable`, { headers: auth, data: { code: totpCode(secret) } });
  expect(enableRes.status()).toBe(200);
  const adminToken = (await enableRes.json()).accessToken;

  const couponRes = await request.post(`${apiUrl}/api/admin/coupons`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      code: couponCode,
      type: 'PERCENTAGE',
      value: 10,
      isActive: true,
    },
  });
  expect(couponRes.status()).toBe(201);

  // 2. A new customer for this run (the OTP resend wait would clash on a shared account), then mobile OTP login
  const customerMobile = `7${runId.padStart(9, '0').slice(-9)}`;
  const registerRes = await request.post(`${apiUrl}/api/auth/register`, {
    data: { name: `Playwright Customer ${runId}`, mobile: customerMobile, email: `pw-customer-${runId}@example.com`, password: 'Customer@12345', consent: true }, // NOSONAR: test credential
  });
  expect(registerRes.status()).toBe(201);
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Mobile OTP' }).click();
  await page.getByLabel('Mobile number').fill(customerMobile);
  await page.getByRole('button', { name: 'Send code' }).click();

  const otpCode = await page.locator('text=Development mode: your code is').locator('span').innerText();
  await page.getByLabel('Verification code').fill(otpCode);
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 3. Open seeded service & pick package
  await page.goto('/services/trademark/trademark-registration');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trademark Registration');

  const card = page.getByRole('complementary', { name: 'Price and packages' });
  await card.getByRole('radio', { name: /Basic/ }).check();

  await page.getByRole('link', { name: 'Get started' }).first().click();
  await expect(page).toHaveURL(/\/apply\/trademark-registration\?package=/);

  // 4. Start application summary step
  await expect(page.getByRole('heading', { name: 'Start your application' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to your details' }).click();
  await expect(page).toHaveURL(/\/apply\/trademark-registration\/[a-f0-9-]+$/);

  // 5. Fill application details form
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();

  // Step 1: Applicant
  await page.getByLabel('Applicant is').selectOption('Individual or sole proprietor');
  await page.getByLabel('Applicant name').fill(`Applicant ${runId}`);
  await page.getByLabel('Address line 1').fill('123 Test Street');
  await page.getByLabel('City').fill('Chandigarh');
  await page.getByLabel('State').selectOption('Punjab');
  await page.getByLabel('PIN code').fill('160017');
  await page.getByLabel('Email').fill(`pw-${runId}@example.com`);
  await page.getByLabel('Mobile number').fill(customerMobile);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2: Your trademark
  await page.getByLabel('What do you want to register?').selectOption('A word or name');
  await page.getByLabel('Word or name to register').fill(`BRAND ${runId}`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 3: Goods and services
  await page.getByLabel('What will you sell under this brand?').fill('Legal and business compliance consultancy');
  await page.getByLabel('Is the brand already in use?').selectOption('Not yet — proposed to be used');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(page).toHaveURL(/\/apply\/trademark-registration\/[a-f0-9-]+\/documents$/);

  // 6. Upload a small PDF document
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  const pdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
  );
  await page.locator('input[type="file"]').first().setInputFiles({
    name: `doc-${runId}.pdf`,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
  });

  await expect(page.getByText(`doc-${runId}.pdf`)).toBeVisible();
  await page.getByRole('button', { name: /Continue|Skip and upload later/ }).click();

  await expect(page).toHaveURL(/\/apply\/trademark-registration\/[a-f0-9-]+\/summary$/);

  // 7. Order Summary, apply coupon, and click Pay with MOCK gateway
  await expect(page.getByRole('heading', { name: 'Order summary' })).toBeVisible();

  await page.getByLabel('Coupon code').fill(couponCode);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(new RegExp(`${couponCode} applied`, 'i'))).toBeVisible();

  const paymentResponsePromise = page.waitForResponse(
    (r) => r.url().includes('/payment') && r.request().method() === 'POST' && r.status() === 200
  );

  await page.getByRole('button', { name: /Pay ₹/i }).click();

  const paymentResponse = await paymentResponsePromise;
  const checkoutData = (await paymentResponse.json()) as { gatewayOrderId: string; paymentId: string; amount: number };
  const { amount } = checkoutData;

  await expect(page.getByText(/Test mode: the mock payment gateway is in use/i)).toBeVisible();

  // 8. Complete the payment through the development gateway's real mock checkout route.
  const mockPaymentRes = await request.post(`${apiUrl}/api/payments/mock/${checkoutData.paymentId}/pay`, {
    headers: { Authorization: paymentResponse.request().headers()['authorization']! },
  });
  expect(mockPaymentRes.status()).toBe(200);

  // 9. The mock gateway opens no window, so the summary does not move on by itself: reload it, then open the payment page
  await page.reload();
  await expect(page.getByText('This order is paid.')).toBeVisible();
  await page.getByRole('link', { name: 'View payment' }).click();
  await expect(page).toHaveURL(/\/payment$/);
  await expect(page.getByRole('heading', { name: 'Payment successful' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Application ID')).toBeVisible();

  const appIdElement = page.locator('p:text("Application ID") + p');
  await expect(appIdElement).toBeVisible();
  const applicationIdCode = await appIdElement.innerText();
  expect(applicationIdCode).toMatch(/^BN\d+$/);

  const refundResponse = await request.post(`${apiUrl}/api/admin/payments/${checkoutData.paymentId}/refunds`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'idempotency-key': crypto.randomUUID() },
    data: { amount, reason: 'Playwright refund journey' },
  });
  expect(refundResponse.status()).toBe(201);
  expect(await refundResponse.json()).toMatchObject({ amount, reason: 'Playwright refund journey', status: 'INITIATED' });

  await page.goto('/dashboard/payments');
  await expect(page.locator('span.text-amber-700:visible').filter({ hasText: 'Refund in progress:' }).first()).toBeVisible();
});
