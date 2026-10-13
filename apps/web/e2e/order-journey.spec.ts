import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * Full order journey e2e test (M3.24):
 * Customer logs in with mobile OTP -> picks service & package -> fills multi-step form ->
 * uploads PDF document -> applies admin-created coupon -> starts MOCK payment ->
 * sends signed mock payment webhook -> verifies success view with Application ID.
 */

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
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
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 1000000).padStart(6, '0');
}

test('full order journey from login to payment success with coupon and document upload', async ({ page, request }) => {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const runId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
  const couponCode = `PWCOUPON${runId}`;

  // 1. Create a coupon via admin API using demo admin login
  const loginRes = await request.post(`${apiUrl}/api/auth/login`, {
    data: { email: 'admin@biznexa.local', password: 'Admin@12345' },
  });
  expect(loginRes.status()).toBe(200);
  const loginData = await loginRes.json();
  let adminToken = loginData.accessToken;

  if (loginData.user.twoFactor.required && !loginData.user.twoFactor.verified) {
    if (!loginData.user.twoFactor.enabled) {
      const setupRes = await request.post(`${apiUrl}/api/auth/2fa/setup`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(setupRes.status()).toBe(200);
      const { secret } = await setupRes.json();
      const enableRes = await request.post(`${apiUrl}/api/auth/2fa/enable`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { code: totpCode(secret) },
      });
      expect(enableRes.status()).toBe(200);
      adminToken = (await enableRes.json()).accessToken;
    }
  }

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

  // 2. Customer logs in using Mobile OTP
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Mobile OTP' }).click();
  await page.getByLabel('Mobile number').fill('9876543210');
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
  await page.getByLabel('State').fill('Punjab');
  await page.getByLabel('PIN code').fill('160017');
  await page.getByLabel('Email').fill(`pw-${runId}@example.com`);
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: Your trademark
  await page.getByLabel('What do you want to register?').selectOption('A word or name');
  await page.getByLabel('Word or name to register').fill(`BRAND ${runId}`);
  await page.getByRole('button', { name: 'Next' }).click();

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
  const checkoutData = (await paymentResponse.json()) as { gatewayOrderId: string; amount: number };
  const { gatewayOrderId, amount } = checkoutData;

  await expect(page.getByText(/Test mode: the mock payment gateway is in use/i)).toBeVisible();

  // 8. Complete the payment via signed webhook
  const paymentId = `pay_mock_${runId}`;
  const eventId = `evt_mock_${runId}`;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? 'mock-webhook-secret';

  const entity = {
    id: paymentId,
    entity: 'payment',
    amount,
    currency: 'INR',
    status: 'captured',
    order_id: gatewayOrderId,
    method: 'upi',
    amount_refunded: 0,
    captured: true,
    error_description: null,
    created_at: Math.floor(Date.now() / 1000),
  };

  const payload = JSON.stringify({
    entity: 'event',
    account_id: 'acc_mock',
    event: 'payment.captured',
    contains: ['payment'],
    payload: { payment: { entity } },
    created_at: Math.floor(Date.now() / 1000),
  });

  const signature = hmacHex(webhookSecret, payload);

  const webhookRes = await request.post(`${apiUrl}/api/payments/webhook`, {
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': eventId,
    },
    data: payload,
  });
  expect(webhookRes.status()).toBe(200);

  // 9. Verify transition to payment success view showing Application ID
  await page.getByRole('link', { name: 'View payment' }).click().catch(() => {});

  await expect(page.getByRole('heading', { name: /Payment successful|Advance received/i })).toBeVisible();
  await expect(page.getByText('Application ID')).toBeVisible();

  const appIdElement = page.locator('p:text("Application ID") + p');
  await expect(appIdElement).toBeVisible();
  const applicationIdCode = await appIdElement.innerText();
  expect(applicationIdCode).toMatch(/^APP-/);
});
