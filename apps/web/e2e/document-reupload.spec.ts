import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { expect, test } from '@playwright/test';

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

test('rejects -> re-upload -> back to review', async ({ page, request }) => {
  test.setTimeout(120_000);
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  const runId = Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
  const couponCode = `PWCOUPON${runId}`;

  // 1. Create admin
  const adminEmail = `pw-admin-${runId}@example.com`;
  const adminPassword = 'Playwright@12345';
  execFileSync('pnpm', ['--filter', '@biznexa/api', 'create-admin'], {
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
    data: { code: couponCode, type: 'PERCENTAGE', value: 10, isActive: true },
  });
  expect(couponRes.status()).toBe(201);

  // 2. Create customer and login
  const customerMobile = `7${runId.padStart(9, '0').slice(-9)}`;
  const registerRes = await request.post(`${apiUrl}/api/auth/register`, {
    data: { name: `Playwright Customer ${runId}`, mobile: customerMobile, email: `pw-customer-${runId}@example.com`, password: 'Customer@12345', consent: true },
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

  // 4. Fill form
  await expect(page.getByRole('heading', { name: 'Start your application' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to your details' }).click();
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();

  await page.getByLabel('Applicant is').selectOption('Individual or sole proprietor');
  await page.getByLabel('Applicant name').fill(`Applicant ${runId}`);
  await page.getByLabel('Address line 1').fill('123 Test Street');
  await page.getByLabel('City').fill('Chandigarh');
  await page.getByLabel('State').selectOption('Punjab');
  await page.getByLabel('PIN code').fill('160017');
  await page.getByLabel('Email').fill(`pw-${runId}@example.com`);
  await page.getByLabel('Mobile number').fill(customerMobile);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByLabel('What do you want to register?').selectOption('A word or name');
  await page.getByLabel('Word or name to register').fill(`BRAND ${runId}`);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByLabel('What will you sell under this brand?').fill('Legal and business compliance consultancy');
  await page.getByLabel('Is the brand already in use?').selectOption('Not yet — proposed to be used');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // 5. Upload document
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await page.locator('input[type="file"]').first().setInputFiles({ name: `doc-${runId}.pdf`, mimeType: 'application/pdf', buffer: pdfBuffer });
  await expect(page.getByText(`doc-${runId}.pdf`)).toBeVisible();
  await page.getByRole('button', { name: /Continue|Skip and upload later/ }).click();

  // 6. Pay
  await expect(page.getByRole('heading', { name: 'Order summary' })).toBeVisible();
  await page.getByLabel('Coupon code').fill(couponCode);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(new RegExp(`${couponCode} applied`, 'i'))).toBeVisible();

  const paymentResponsePromise = page.waitForResponse(r => r.url().includes('/payment') && r.request().method() === 'POST' && r.status() === 200);
  await page.getByRole('button', { name: /Pay ₹/i }).click();
  const paymentResponse = await paymentResponsePromise;
  const checkoutData = await paymentResponse.json() as { gatewayOrderId: string; amount: number };

  const webhookPayload = JSON.stringify({
    entity: 'event', account_id: 'acc_mock', event: 'payment.captured', contains: ['payment'],
    payload: { payment: { entity: { id: `pay_mock_${runId}`, entity: 'payment', amount: checkoutData.amount, currency: 'INR', status: 'captured', order_id: checkoutData.gatewayOrderId, method: 'upi', amount_refunded: 0, captured: true, error_description: null, created_at: Math.floor(Date.now() / 1000) } } },
    created_at: Math.floor(Date.now() / 1000),
  });
  const webhookRes = await request.post(`${apiUrl}/api/payments/webhook`, {
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': hmacHex('mock-webhook-secret', webhookPayload), 'x-razorpay-event-id': `evt_mock_${runId}` },
    data: webhookPayload,
  });
  expect(webhookRes.status()).toBe(200);

  await page.reload();
  await page.getByRole('link', { name: 'View payment' }).click();
  await expect(page.getByRole('heading', { name: 'Payment successful' })).toBeVisible({ timeout: 15_000 });
  const appIdElement = page.locator('p:text("Application ID") + p');
  await expect(appIdElement).toBeVisible();
  const applicationId = await appIdElement.innerText();

  // 7. Find document in admin review queue
  const queueRes1 = await request.get(`${apiUrl}/api/admin/documents/review-queue`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const queue1 = await queueRes1.json();
  const item1 = queue1.items.find((i: { application: { code: string }, id: string, version: number, fileName: string }) => i.application.code === applicationId);
  expect(item1).toBeDefined();

  // 8. Reject document
  const rejectReason = 'Image is too blurry, please upload a clear one.';
  const rejectRes = await request.post(`${apiUrl}/api/admin/documents/${item1.id}/reject`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { reason: rejectReason }
  });
  expect(rejectRes.status()).toBe(201);

  // 9. Customer views rejected document, sees reason, re-uploads
  await page.goto('/dashboard');
  await page.getByRole('link', { name: applicationId }).first().click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/applications/`));
  await page.getByRole('tab', { name: 'Documents' }).click();

  // check for rejection reason
  await expect(page.getByText('Rejected', { exact: true })).toBeVisible();
  await expect(page.getByText(rejectReason)).toBeVisible();

  // upload new document
  const pdfBuffer2 = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await page.locator('input[type="file"]').first().setInputFiles({ name: `doc-v2-${runId}.pdf`, mimeType: 'application/pdf', buffer: pdfBuffer2 });
  await expect(page.getByText(`doc-v2-${runId}.pdf`)).toBeVisible();

  // wait for it to be uploaded
  await expect(page.getByText('Uploaded', { exact: true })).toBeVisible();

  // 10. Admin review queue should list it again
  const queueRes2 = await request.get(`${apiUrl}/api/admin/documents/review-queue`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const queue2 = await queueRes2.json();
  const item2 = queue2.items.find((i: { application: { code: string }, id: string, version: number, fileName: string }) => i.application.code === applicationId);
  expect(item2).toBeDefined();
  expect(item2.version).toBe(2);
  expect(item2.fileName).toBe(`doc-v2-${runId}.pdf`);
});
